const Url = require('../models/Url');
const Counter = require('../models/Counter');
const { encodeBase62 } = require('../utils/base62');
const { getRedisClient } = require('../utils/redisClient');

function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

exports.shortenUrl = async (req, res, next) => {
  try {
    const { longUrl } = req.body;

    if (!longUrl) {
      return res.status(400).json({ error: 'longUrl is required' });
    }

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

    const requestHost = req.headers.host;
    if (
      parsedLongUrl.host === parsedBaseUrl.host ||
      (requestHost && parsedLongUrl.host === requestHost)
    ) {
      return res.status(400).json({ error: 'Cannot shorten a URL that is already a TinyScale shortened URL' });
    }

    const existing = await Url.findOne({ longUrl });
    if (existing) {
      return res.status(200).json({
        shortCode: existing.shortCode,
        shortUrl: `${baseUrl}/${existing.shortCode}`,
        longUrl: existing.longUrl
      });
    }

    const counter = await Counter.findByIdAndUpdate(
      'url_id',
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );

    const shortCode = encodeBase62(counter.seq);

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
        const concurrentExisting = await Url.findOne({ longUrl });
        if (concurrentExisting) {
          return res.status(200).json({
            shortCode: concurrentExisting.shortCode,
            shortUrl: `${baseUrl}/${concurrentExisting.shortCode}`,
            longUrl: concurrentExisting.longUrl
          });
        }
      }
      throw error;
    }
  } catch (error) {
    next(error);
  }
};

exports.redirectToUrl = async (req, res, next) => {
  try {
    const { shortCode } = req.params;
    const redisKey = `url:${shortCode}`;
    let longUrl = null;

    const redisClient = getRedisClient();
    if (redisClient) {
      try {
        longUrl = await redisClient.get(redisKey);
      } catch (err) {
        console.warn('Redis GET failed, falling back to MongoDB:', err.message);
      }
    }

    if (longUrl) {
      console.log('CACHE HIT');
      await Url.updateOne({ shortCode }, { $inc: { clicks: 1 } });
      return res.redirect(longUrl);
    }

    console.log('CACHE MISS');
    const urlDoc = await Url.findOne({ shortCode });
    if (!urlDoc) {
      return res.status(404).json({ error: 'Short URL not found' });
    }

    if (redisClient) {
      try {
        await redisClient.set(redisKey, urlDoc.longUrl, { EX: 3600 });
      } catch (err) {
        console.warn('Redis SET failed:', err.message);
      }
    }

    await Url.updateOne({ shortCode }, { $inc: { clicks: 1 } });
    return res.redirect(urlDoc.longUrl);
  } catch (error) {
    next(error);
  }
};

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
