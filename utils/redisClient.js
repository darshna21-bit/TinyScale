const redis = require('redis');

let redisClient = null;
let isMockClient = false;

/**
 * In-memory Mock Redis Client used as a fallback when the Redis server is offline.
 * Implements basic GET, SET, and DEL operations with TTL support.
 */
class MemoryMockRedisClient {
  constructor() {
    this.store = new Map();
    this.isOpen = true;
    this.isReady = true;
  }

  async connect() {
    return Promise.resolve();
  }

  async get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    // Handle expired cache entries
    if (entry.expiry && entry.expiry < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key, value, options) {
    let expiry = null;
    if (options && options.EX) {
      expiry = Date.now() + options.EX * 1000;
    }
    this.store.set(key, { value, expiry });
    return 'OK';
  }

  async del(key) {
    return this.store.delete(key) ? 1 : 0;
  }

  async eval(script, options) {
    const key = options.keys[0];
    const args = options.arguments;
    const capacity = parseFloat(args[0]);
    const refillRate = parseFloat(args[1]);
    const now = parseFloat(args[2]);
    const ttl = parseFloat(args[3]);

    const entry = this.store.get(key);
    let tokens = capacity;
    let lastRefill = now;

    if (entry) {
      if (entry.expiry && entry.expiry < Date.now()) {
        this.store.delete(key);
      } else {
        const parsed = JSON.parse(entry.value);
        tokens = parseFloat(parsed.tokens);
        lastRefill = parseFloat(parsed.lastRefill);
      }
    }

    const elapsed = (now - lastRefill) / 1000;
    const tokensToAdd = elapsed * refillRate;
    tokens = Math.min(capacity, tokens + tokensToAdd);

    let allowed = 0;
    if (tokens >= 1) {
      tokens -= 1;
      allowed = 1;
    }

    const result = {
      tokens: tokens,
      lastRefill: now
    };

    this.store.set(key, {
      value: JSON.stringify(result),
      expiry: Date.now() + ttl * 1000
    });

    return allowed;
  }

  async xAdd(key, id, fields) {
    return '123456789-0';
  }
}

/**
 * Connects to Redis server asynchronously.
 * If connection fails, falls back to MemoryMockRedisClient to treat Redis as a non-critical optimization.
 */
async function connectRedis() {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

  try {
    redisClient = redis.createClient({
      url: redisUrl,
      socket: {
        reconnectStrategy: (retries) => {
          // Retry connecting up to 3 times before falling back
          if (retries > 3) {
            return new Error('Redis connection retry limit reached');
          }
          return 1000;
        }
      }
    });

    redisClient.on('error', (err) => {
      console.warn('Redis Client Warning:', err.message);
    });

    redisClient.on('ready', () => {
      console.log('Redis client is ready to receive commands.');
    });

    await redisClient.connect();
    console.log('Successfully connected to Redis.');
  } catch (err) {
    console.warn(`WARNING: Could not connect to Redis at ${redisUrl}. Falling back to local in-memory cache. Error: ${err.message}`);
    if (redisClient && typeof redisClient.disconnect === 'function') {
      try {
        await redisClient.disconnect();
      } catch (_) {
        // ignore errors on forced disconnect
      }
    }
    redisClient = new MemoryMockRedisClient();
    isMockClient = true;
  }
}

/**
 * Returns the active Redis client if it is connected and ready to process commands.
 * Otherwise, returns null to trigger database fallback.
 */
function getRedisClient() {
  if (redisClient && redisClient.isOpen && redisClient.isReady) {
    return redisClient;
  }
  return null;
}

/**
 * Identifies whether we are running the mockup or a real Redis client.
 */
function getIsMockClient() {
  return isMockClient;
}

/**
 * Gracefully disconnects the Redis client. Used for cleanup in tests.
 */
async function disconnectRedis() {
  if (redisClient) {
    try {
      if (typeof redisClient.quit === 'function') {
        await redisClient.quit();
      }
    } catch (err) {
      console.warn('Error quitting Redis client:', err.message);
    }
    redisClient = null;
  }
}

module.exports = {
  connectRedis,
  getRedisClient,
  getIsMockClient,
  disconnectRedis
};
