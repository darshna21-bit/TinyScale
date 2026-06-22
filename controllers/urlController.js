const Url = require('../models/Url');
const Counter = require('../models/Counter');
const { encodeBase62 } = require('../utils/base62');
const { getRedisClient } = require('../utils/redisClient');

/**
 * Asynchronously push a click event to the Redis Stream.
 * Fail open silently if Redis is offline or XADD fails.
 */
async function queueClickEvent(shortCode) {
  const redisClient = getRedisClient();
  if (redisClient) {
    try {
      await redisClient.xAdd('click_events', '*', {
        shortCode,
        timestamp: String(Date.now())
      });
    } catch (err) {
      console.warn(`Failed to queue click event for ${shortCode}:`, err.message);
    }
  }
}

/**
 * Validates whether a string is a well-formed http/https URL.
 * @param {string} string 
 * @returns {boolean}
 */
function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

/**
 * Shorten a long URL.
 */
exports.shortenUrl = async (req, res, next) => {
  try {
    const { longUrl } = req.body;

    if (!longUrl) {
      return res.status(400).json({ error: 'longUrl is required' });
    }

    // 1. Reject malformed URLs
    if (!isValidUrl(longUrl)) {
      return res.status(400).json({ error: 'Invalid or malformed URL. URL must start with http:// or https://' });
    }

    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    let parsedLongUrl;
    let parsedBaseUrl;
    try {
      parsedLongUrl = new URL(longUrl);
      parsedBaseUrl = new URL(baseUrl);
    } catch (_) {
      return res.status(400).json({ error: 'Error parsing URLs' });
    }

    // 2. Prevent shortening an already-shortened URL (checks host names)
    const requestHost = req.headers.host;
    if (
      parsedLongUrl.host === parsedBaseUrl.host ||
      (requestHost && parsedLongUrl.host === requestHost)
    ) {
      return res.status(400).json({ error: 'Cannot shorten a URL that is already a TinyScale shortened URL' });
    }

    // 3. First check if the URL already exists in database (check-then-act optimization to save counters)
    const existing = await Url.findOne({ longUrl });
    if (existing) {
      return res.status(200).json({
        shortCode: existing.shortCode,
        shortUrl: `${baseUrl}/${existing.shortCode}`,
        longUrl: existing.longUrl
      });
    }

    // 4. Atomically increment counter to generate a unique ID
    const counter = await Counter.findByIdAndUpdate(
      'url_id',
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );

    const shortCode = encodeBase62(counter.seq);

    // 5. Attempt insertion and handle duplicate key (code 11000) race conditions
    try {
      const newUrl = new Url({
        shortCode,
        longUrl
      });
      await newUrl.save();

      return res.status(201).json({
        shortCode,
        shortUrl: `${baseUrl}/${shortCode}`,
        longUrl
      });
    } catch (error) {
      if (error.code === 11000) {
        // A duplicate key collision occurred (another request inserted this longUrl concurrently)
        // Re-query for the existing document to return it
        const concurrentExisting = await Url.findOne({ longUrl });
        if (concurrentExisting) {
          return res.status(200).json({
            shortCode: concurrentExisting.shortCode,
            shortUrl: `${baseUrl}/${concurrentExisting.shortCode}`,
            longUrl: concurrentExisting.longUrl
          });
        }
      }
      // Re-throw any other mongoose validation or connection errors to be handled by middleware
      throw error;
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Redirect short code to long URL using cache-aside pattern.
 */
exports.redirectToUrl = async (req, res, next) => {
  try {
    const { shortCode } = req.params;
    const redisKey = `url:${shortCode}`;
    let longUrl = null;

    // 1. Try to fetch from Redis (non-critical, catches exceptions)
    const redisClient = getRedisClient();
    if (redisClient) {
      try {
        longUrl = await redisClient.get(redisKey);
      } catch (err) {
        console.warn('Redis GET failed, falling back to MongoDB:', err.message);
      }
    }

    // 2. Cache Hit Path
    if (longUrl) {
      console.log('CACHE HIT');

      // Queue click event in Redis Stream asynchronously (fire-and-forget)
      queueClickEvent(shortCode);

      return res.redirect(longUrl);
    }

    // 3. Cache Miss Path
    console.log('CACHE MISS');
    const urlDoc = await Url.findOne({ shortCode });
    if (!urlDoc) {
      return res.status(404).json({ error: 'Short URL not found' });
    }

    // Populate Redis with TTL 3600 seconds (non-critical)
    if (redisClient) {
      try {
        await redisClient.set(redisKey, urlDoc.longUrl, { EX: 3600 });
      } catch (err) {
        console.warn('Redis SET failed:', err.message);
      }
    }

    // Queue click event in Redis Stream asynchronously (fire-and-forget)
    queueClickEvent(shortCode);

    // Immediate redirect response
    return res.redirect(urlDoc.longUrl);
  } catch (error) {
    next(error);
  }
};

/**
 * Manually flush a cached shortCode entry (Admin utility).
 */
exports.flushCache = async (req, res, next) => {
  try {
    const { shortCode } = req.params;
    const redisKey = `url:${shortCode}`;
    const redisClient = getRedisClient();

    if (!redisClient) {
      return res.status(503).json({ error: 'Redis client is not connected or offline' });
    }

    const deleted = await redisClient.del(redisKey);
    return res.status(200).json({
      message: deleted ? 'Cache entry cleared successfully' : 'Cache entry not found',
      shortCode
    });
  } catch (error) {
    next(error);
  }
};
