require('dotenv').config();
const mongoose = require('mongoose');
const os = require('os');
const Url = require('./models/Url');
const { connectRedis, getRedisClient } = require('./utils/redisClient');

const MONGO_URL = process.env.MONGO_URL;
if (!MONGO_URL) {
  console.error('CRITICAL: MONGO_URL is missing in environment');
  process.exit(1);
}

// Set a fixed, deterministic consumer name for crash recovery
const consumerName = 'worker-primary';
const STREAM_KEY = 'click_events';
const GROUP_NAME = 'click_group';

// In-memory queue state
let pendingClicks = {}; // shortCode -> incrementCount
let pendingIds = [];    // Array of stream message IDs to acknowledge
let lastFlushTime = Date.now();
let hasRecoveredPending = false;
const FLUSH_INTERVAL_MS = 2000;
const BATCH_SIZE_LIMIT = 10;

async function bootstrap() {
  try {
    // 1. Connect to MongoDB
    await mongoose.connect(MONGO_URL);
    console.log('Worker successfully connected to MongoDB.');

    // 2. Connect to Redis
    await connectRedis();
    const redisClient = getRedisClient();
    if (!redisClient) {
      console.warn('Worker starting in offline mock mode (Redis unavailable). Clicks will not be processed.');
    } else {
      console.log('Worker successfully connected to Redis.');
      // Create the consumer group if it does not exist
      try {
        await redisClient.xGroupCreate(STREAM_KEY, GROUP_NAME, '$', {
          MKSTREAM: true
        });
        console.log(`Consumer group "${GROUP_NAME}" created on stream "${STREAM_KEY}".`);
      } catch (err) {
        if (err.message && err.message.includes('BUSYGROUP')) {
          console.log(`Consumer group "${GROUP_NAME}" already exists.`);
        } else {
          throw err;
        }
      }
    }

    // 3. Start the consuming loop
    runConsumeLoop();
  } catch (err) {
    console.error('Worker bootstrap failed:', err);
    process.exit(1);
  }
}

async function runConsumeLoop() {
  const redisClient = getRedisClient();
  
  // If Redis is not connected, poll occasionally to see if it comes back online
  if (!redisClient || typeof redisClient.xReadGroup !== 'function') {
    setTimeout(runConsumeLoop, 5000);
    return;
  }

  try {
    let response;
    // Try to read pending messages first (id: '0') to recover from crashes (only once at startup)
    if (!hasRecoveredPending) {
      response = await redisClient.xReadGroup(
        GROUP_NAME,
        consumerName,
        [{ key: STREAM_KEY, id: '0' }],
        { COUNT: 10 }
      );
      hasRecoveredPending = true;
    }

    // If no pending messages, read new messages (id: '>')
    if (!response || response.length === 0 || response[0].messages.length === 0) {
      response = await redisClient.xReadGroup(
        GROUP_NAME,
        consumerName,
        [{ key: STREAM_KEY, id: '>' }],
        { COUNT: 10, BLOCK: 1000 }
      );
    }

    if (response && response.length > 0) {
      for (const stream of response) {
        for (const msg of stream.messages) {
          const { shortCode } = msg.message;
          if (shortCode) {
            pendingClicks[shortCode] = (pendingClicks[shortCode] || 0) + 1;
            pendingIds.push(msg.id);
          }
        }
      }
    }

    // Check if we should flush the batch to MongoDB
    const timeSinceLastFlush = Date.now() - lastFlushTime;
    const shouldFlush = pendingIds.length >= BATCH_SIZE_LIMIT || 
                         (timeSinceLastFlush >= FLUSH_INTERVAL_MS && pendingIds.length > 0);

    if (shouldFlush) {
      await flushClicks();
    }

    // Run the next iteration immediately
    setImmediate(runConsumeLoop);
  } catch (err) {
    console.error('Error in consume loop:', err.message);
    // Wait a bit before retrying to prevent hot looping in case of persistent errors
    setTimeout(runConsumeLoop, 1000);
  }
}

async function flushClicks() {
  const redisClient = getRedisClient();
  if (pendingIds.length === 0) return;

  const clickCountToFlush = pendingIds.length;
  console.log(`Flushing batch of ${clickCountToFlush} click event(s) to MongoDB...`);

  try {
    // Prepare bulk operation
    const ops = Object.keys(pendingClicks).map(shortCode => ({
      updateOne: {
        filter: { shortCode },
        update: { $inc: { clicks: pendingClicks[shortCode] } }
      }
    }));

    // Write to MongoDB
    await Url.bulkWrite(ops);
    console.log(`Successfully updated clicks for ${Object.keys(pendingClicks).length} shortCode(s) in MongoDB.`);

    // Acknowledge the messages in Redis only after a successful write
    if (redisClient) {
      await redisClient.xAck(STREAM_KEY, GROUP_NAME, pendingIds);
      console.log(`Acknowledged ${clickCountToFlush} stream message(s) in Redis.`);
    }

    // Reset local queue state
    pendingClicks = {};
    pendingIds = [];
    lastFlushTime = Date.now();
  } catch (err) {
    console.error('Failed to flush click batch to MongoDB. Will retry on next loop iteration. Error:', err.message);
    // Note: pendingClicks and pendingIds are NOT cleared so they will be retried in the next loop iteration.
  }
}

// Graceful teardown
process.on('SIGTERM', async () => {
  console.log('Worker received SIGTERM. Flushing final pending clicks and shutting down...');
  try {
    await flushClicks();
    await mongoose.disconnect();
  } catch (err) {
    console.error('Error during worker cleanup:', err.message);
  }
  process.exit(0);
});

bootstrap();
