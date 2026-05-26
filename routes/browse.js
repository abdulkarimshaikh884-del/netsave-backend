// ═══════════════════════════════════════════════════════
// /api/browse — Cloud Browser Endpoint (Stubbed for Render.com)
// ═══════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const { browseLimiter } = require('../middleware/rateLimiter');

// Apply rate limit for browsing requests
router.use(browseLimiter);

/**
 * POST /api/browse
 * Returns a fixed error payload because Puppeteer is removed for Render.com.
 */
router.post('/', (req, res) => {
  return res.status(503).json({ error: 'Browser feature unavailable' });
});

/**
 * GET /api/browse/status
 * Returns offline status.
 */
router.get('/status', (req, res) => {
  return res.json({
    isRunning: false,
    activePages: 0,
    maxPages: 0,
    available: 0,
    message: 'Browser features are disabled on this instance.'
  });
});

module.exports = router;
