// ═══════════════════════════════════════════════════════
// Rate Limiter Middleware
// Per-IP and per-user rate limiting for Oracle Cloud
// ═══════════════════════════════════════════════════════

const rateLimit = require('express-rate-limit');

/**
 * Create a configurable rate limiter instance.
 *
 * @param {Object} options
 * @param {number} options.windowMs  - Time window in milliseconds
 * @param {number} options.max       - Max requests per window
 * @returns {Function} Express middleware
 */
function createRateLimiter({ windowMs = 60000, max = 30 } = {}) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,  // Return rate limit info in `RateLimit-*` headers
    legacyHeaders: false,   // Disable `X-RateLimit-*` headers

    // Use UID if authenticated, else fall back to IP
    keyGenerator: (req) => {
      return req.uid || req.ip;
    },

    // Custom response when limit exceeded
    handler: (req, res) => {
      console.warn('[RATE_LIMIT] Exceeded:', {
        key: req.uid || req.ip,
        path: req.path,
      });

      res.status(429).json({
        success: false,
        error: 'TooManyRequests',
        message: 'Too many requests. Please wait before trying again.',
        retryAfter: Math.ceil(windowMs / 1000),
      });
    },

    // Skip rate limiting for health check
    skip: (req) => req.path === '/health',
  });
}

/**
 * Stricter rate limiter for the /browse endpoint
 * (Puppeteer is resource-heavy — limit to 10 req/min)
 */
const browseLimiter = createRateLimiter({
  windowMs: 60000,
  max: 10,
});

module.exports = { createRateLimiter, browseLimiter };
