const express = require('express');
const router = express.Router();
const urlController = require('../controllers/urlController');

// Route for shortening a URL
router.post('/shorten', urlController.shortenUrl);

// Route to manually flush cached entries
router.delete('/cache/:shortCode', urlController.flushCache);

// Route for redirecting from a short code to the long URL
router.get('/:shortCode', urlController.redirectToUrl);

module.exports = router;
