const { getRedisClient } = require('../utils/redisClient');

// Atomic Lua script to execute token bucket verification, refill calculations, and decrement operations.
const LUA_RATE_LIMIT_SCRIPT = `
  local key = KEYS[1]
  local capacity = tonumber(ARGV[1])
  local refillRate = tonumber(ARGV[2])
  local now = tonumber(ARGV[3])
  local ttl = tonumber(ARGV[4])

  local data = redis.call('GET', key)
  local tokens = capacity
  local lastRefill = now

  if data then
    local parsed = cjson.decode(data)
    tokens = tonumber(parsed.tokens)
    lastRefill = tonumber(parsed.lastRefill)
  end

  local elapsed = (now - lastRefill) / 1000
  local tokensToAdd = elapsed * refillRate
  tokens = math.min(capacity, tokens + tokensToAdd)

  local allowed = 0
  if tokens >= 1 then
    tokens = tokens - 1
    allowed = 1
  end

  local result = {
    tokens = tokens,
    lastRefill = now
  }
  redis.call('SET', key, cjson.encode(result), 'EX', ttl)

  return allowed
`;

/**
 * Express middleware for client IP rate limiting.
 * Capacity: 10, Refill Rate: 1/sec. TTL: 60s.
 */
async function rateLimiter(req, res, next) {
  try {
    // Get client IP address
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const key = `rate_limit:${ip}`;

    const capacity = 10;
    const refillRate = 1; // 1 token per second
    const ttl = 60; // 60 seconds expiration
    const now = Date.now();

    const redisClient = getRedisClient();
    if (!redisClient) {
      // Fail open if Redis client is offline or not connected
      return next();
    }

    // Atomically execute checking and decrementing
    const allowed = await redisClient.eval(LUA_RATE_LIMIT_SCRIPT, {
      keys: [key],
      arguments: [
        String(capacity),
        String(refillRate),
        String(now),
        String(ttl)
      ]
    });

    if (allowed === 1) {
      return next();
    }

    return res.status(429).json({
      error: 'Too Many Requests',
      message: 'Rate limit exceeded. Please try again later.'
    });
  } catch (error) {
    // Log warnings and fail open so rate-limiting issues don't take down the app
    console.warn('Rate limiter warning, failing open:', error.message);
    return next();
  }
}

module.exports = rateLimiter;
