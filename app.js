require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const os = require('os');
const urlRoutes = require('./routes/urlRoutes');
const errorHandler = require('./middlewares/errorHandler');
const { connectRedis } = require('./utils/redisClient');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URL = process.env.MONGO_URL;

if (!MONGO_URL) {
  console.error('CRITICAL: MONGO_URL environment variable is missing from .env');
  process.exit(1);
}

// Connect to MongoDB
if (process.env.NODE_ENV !== 'test') {
  mongoose.connect(MONGO_URL)
    .then(() => {
      console.log('Successfully connected to MongoDB.');
    })
    .catch((err) => {
      console.error('MongoDB connection error:', err);
      process.exit(1);
    });
}

// Connect to Redis
connectRedis();

// Middlewares
app.set('trust proxy', true);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logger middleware
app.use((req, res, next) => {
  console.log(`[${os.hostname()}] ${req.method} ${req.originalUrl || req.url}`);
  next();
});

// Routes
app.use('/', urlRoutes);

// Global Error Handler
app.use(errorHandler);

// Start server
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[${os.hostname()}] TinyScale server is running on port ${PORT}`);
    console.log(`[${os.hostname()}] Base URL is configured as: ${process.env.BASE_URL || `http://localhost:${PORT}`}`);
  });
}

module.exports = app;
