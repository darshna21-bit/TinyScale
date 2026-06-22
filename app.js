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

// Connect to MongoDB (skip in test environment to avoid open handles and TLS issues)
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

// Connect to Redis (non-critical, errors handled internally)
connectRedis();

// Middlewares
app.set('trust proxy', true);

// Request logger middleware (logs container hostname and request method/url)
app.use((req, res, next) => {
  console.log(`[${os.hostname()}] ${req.method} ${req.originalUrl || req.url}`);
  next();
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health Check Endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' });
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

module.exports = app; // exported for testing purposes if needed
