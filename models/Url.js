const mongoose = require('mongoose');

const UrlSchema = new mongoose.Schema({
  shortCode: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  longUrl: {
    type: String,
    required: true,
    unique: true,
    maxlength: 2048,
    trim: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  clicks: {
    type: Number,
    default: 0
  }
});

module.exports = mongoose.model('Url', UrlSchema);
