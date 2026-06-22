/**
 * Global error handling middleware for handling database errors, validation failures, and operational exceptions.
 */
function errorHandler(err, req, res, next) {
  console.error('Error occurred in request:', err);

  const statusCode = err.status || err.statusCode || 500;
  const message = err.message || 'An unexpected error occurred on the server';

  res.status(statusCode).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
}

module.exports = errorHandler;
