const request = require('supertest');
const app = require('../app');
const mongoose = require('mongoose');
const { getRedisClient, disconnectRedis } = require('../utils/redisClient');

describe('IP-Based Token Bucket Rate Limiter', () => {
  let server;

  beforeAll(async () => {
    console.log('beforeAll starting for rate limiter tests...');
    
    // Start Express server on random port
    server = app.listen(0);

    // Wait for asynchronous Redis connection to be ready
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        clearInterval(interval);
        reject(new Error('Redis connection timed out in test startup'));
      }, 10000);

      const interval = setInterval(() => {
        if (getRedisClient()) {
          clearInterval(interval);
          clearTimeout(timeout);
          resolve();
        }
      }, 50);
    });
    console.log('Redis client is confirmed connected in tests beforeAll.');
  }, 12000);

  afterAll(async () => {
    console.log('afterAll starting. Cleaning up...');
    
    // Close Express server
    if (server) {
      await new Promise((resolve) => server.close(resolve));
      console.log('Express server closed.');
    }

    // Clean up Redis keys used for testing
    const redisClient = getRedisClient();
    if (redisClient) {
      try {
        await redisClient.del('rate_limit:127.0.0.1');
        await redisClient.del('rate_limit:::ffff:127.0.0.1');
        await redisClient.del('rate_limit:127.0.0.2');
        await redisClient.del('rate_limit:::ffff:127.0.0.2');
        console.log('Cleaned up rate limit keys in Redis.');
      } catch (err) {
        console.warn('Cleanup warning in tests:', err.message);
      }
    }

    // Disconnect Redis cleanly
    await disconnectRedis();
    console.log('Redis connection closed.');

    // Disconnect Mongoose cleanly if connected
    if (mongoose.connection && mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
      console.log('Mongoose connection closed.');
    }
  }, 15000);

  describe('Sequential Request Behavior', () => {
    test('should allow 10 requests and return 429 Too Many Requests on the 11th', async () => {
      const testIp = '127.0.0.1';
      const redisClient = getRedisClient();
      if (redisClient) {
        await redisClient.del(`rate_limit:${testIp}`);
        await redisClient.del(`rate_limit:::ffff:${testIp}`);
      }

      // First 10 requests sequentially must pass rate limits, but return 400 Bad Request due to malformed longUrl
      for (let i = 0; i < 10; i++) {
        const res = await request(server)
          .post('/shorten')
          .send({ longUrl: 'invalid-url' })
          .set('X-Forwarded-For', testIp);
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Invalid or malformed URL');
      }

      // The 11th request must return 429 Too Many Requests
      const res = await request(server)
        .post('/shorten')
        .send({ longUrl: 'invalid-url' })
        .set('X-Forwarded-For', testIp);
      expect(res.status).toBe(429);
      expect(res.body).toEqual({
        error: 'Too Many Requests',
        message: 'Rate limit exceeded. Please try again later.'
      });
    });
  });

  describe('Concurrent Request Behavior (Lua script atomicity check)', () => {
    test('should allow exactly 10 requests and reject 5 with 429 when 15 requests are fired simultaneously', async () => {
      const testIp = '127.0.0.2';
      const redisClient = getRedisClient();
      if (redisClient) {
        await redisClient.del(`rate_limit:${testIp}`);
        await redisClient.del(`rate_limit:::ffff:${testIp}`);
      }

      // Fire 15 requests concurrently using Promise.all
      const requests = Array.from({ length: 15 }).map(() =>
        request(server)
          .post('/shorten')
          .send({ longUrl: 'invalid-url' })
          .set('X-Forwarded-For', testIp)
      );

      const responses = await Promise.all(requests);

      let successCount = 0; // expected 400
      let rateLimitedCount = 0; // expected 429

      responses.forEach((res) => {
        if (res.status === 429) {
          rateLimitedCount++;
        } else if (res.status === 400) {
          successCount++;
        }
      });

      // Verify that exactly 10 requests got through rate limiting (status 400) and 5 were blocked (status 429)
      expect(successCount).toBe(10);
      expect(rateLimitedCount).toBe(5);
    });
  });
});
