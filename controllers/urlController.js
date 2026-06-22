const Url = require('../models/Url');
const Counter = require('../models/Counter');
const { encodeBase62 } = require('../utils/base62');

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

    console.log('DATABASE HIT');
    const urlDoc = await Url.findOne({ shortCode });
    if (!urlDoc) {
      return res.status(404).json({ error: 'Short URL not found' });
    }

    await Url.updateOne({ shortCode }, { $inc: { clicks: 1 } });
    return res.redirect(urlDoc.longUrl);
  } catch (error) {
    next(error);
  }
};
