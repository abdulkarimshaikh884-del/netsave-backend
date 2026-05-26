// ═══════════════════════════════════════════════════════
// /api/browse — Cloud Browser Endpoint
// Fetches, compresses, and returns web pages via Puppeteer
// ═══════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();

const { fetchPage, getBrowserStatus } = require('../services/browserService');
const { browseLimiter } = require('../middleware/rateLimiter');
const { getDb, now, fieldValue } = require('../config/firebase');
const {
  isValidUrl,
  normalizeUrl,
  extractDomain,
  formatBytes,
  getTodayIST,
  getCurrentHourIST,
  generateSessionId,
  successResponse,
  errorResponse,
} = require('../utils/helpers');

// Apply stricter rate limit for browsing (resource-heavy)
router.use(browseLimiter);

// ── Blocked domains (security) ──
const UNSAFE_DOMAINS = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '10.',
  '172.16.',
  '192.168.',
  'metadata.google',
  '169.254.',
];

/**
 * POST /api/browse
 *
 * Request Body:
 * {
 *   "url": "https://example.com",
 *   "mode": "full" | "lite" | "text",   // optional, default "full"
 *   "sessionId": "uuid"                  // optional, for grouping
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "url": "...",
 *     "title": "...",
 *     "html": "...",
 *     "savings": { ... },
 *     ...
 *   }
 * }
 */
router.post('/', async (req, res, next) => {
  if (process.env.PUPPETEER_SKIP_DOWNLOAD === 'true') {
    return res.status(503).json(
      errorResponse('Browser feature not available on this server', 'BROWSER_UNAVAILABLE')
    );
  }
  const { url: rawUrl, mode = 'full', sessionId } = req.body;
  const uid = req.uid;

  // ── Validation ──
  if (!rawUrl) {
    return res.status(400).json(
      errorResponse('URL is required. Send { "url": "https://example.com" }', 'MISSING_URL')
    );
  }

  const url = normalizeUrl(rawUrl);

  if (!isValidUrl(url)) {
    return res.status(400).json(
      errorResponse('Invalid URL. Must be a valid http/https URL.', 'INVALID_URL')
    );
  }

  // Block internal/private IPs (SSRF protection)
  const isUnsafe = UNSAFE_DOMAINS.some(domain => url.includes(domain));
  if (isUnsafe) {
    return res.status(403).json(
      errorResponse('This URL is not allowed for security reasons.', 'BLOCKED_URL')
    );
  }

  if (!['full', 'lite', 'text'].includes(mode)) {
    return res.status(400).json(
      errorResponse('Mode must be "full", "lite", or "text".', 'INVALID_MODE')
    );
  }

  try {
    // ── Fetch via Puppeteer ──
    const result = await fetchPage(url, { mode });

    // ── Save to Firebase (async — don't block response) ──
    saveToFirebase(uid, result, sessionId).catch(err => {
      console.error('[BROWSE] Firebase save failed:', err.message);
    });

    // ── Return compressed page ──
    return res.json(successResponse({
      url: result.finalUrl,
      title: result.title,
      favicon: result.favicon,
      domain: extractDomain(result.finalUrl),
      content: mode === 'text' ? result.text : result.html,
      mode: result.mode,
      savings: {
        originalSize: result.originalSize,
        compressedSize: result.compressedSize,
        savedBytes: result.savings,
        savedFormatted: formatBytes(result.savings),
        compressionRatio: result.compressionRatio,
        imagesCompressed: result.imagesCompressed,
        imageSavings: result.totalImageSavings,
        imageSavingsFormatted: formatBytes(result.totalImageSavings),
        blockedRequests: result.blockedRequests,
      },
      performance: {
        loadTimeMs: result.loadTimeMs,
      },
    }, `Page loaded — ${result.compressionRatio}% data saved`));

  } catch (err) {
    console.error('[BROWSE] Failed:', { url, uid, error: err.message });

    if (err.statusCode === 503) {
      return res.status(503).json(
        errorResponse(err.message, 'SERVER_BUSY')
      );
    }

    if (err.message.includes('timeout') || err.message.includes('Timeout')) {
      return res.status(504).json(
        errorResponse('Page took too long to load. Try again or use "lite" mode.', 'TIMEOUT')
      );
    }

    next(err);
  }
});

/**
 * GET /api/browse/status
 *
 * Returns current browser status (active pages, capacity).
 */
router.get('/status', (req, res) => {
  const status = getBrowserStatus();
  res.json(successResponse({
    ...status,
    available: status.maxPages - status.activePages,
  }, 'Browser status'));
});

// ═══════════════════════════════════════════════════════
// Firebase Persistence (runs in background)
// ═══════════════════════════════════════════════════════

/**
 * Save browse result to Firestore:
 * 1. Add to browserHistory subcollection
 * 2. Update today's dataUsage document
 * 3. Update user's totalDataSavedMB
 */
async function saveToFirebase(uid, result, sessionId = null) {
  const db = getDb();
  const today = getTodayIST();
  const currentHour = getCurrentHourIST().toString();
  const savedKB = Math.round(result.savings / 1024);
  const savedMB = parseFloat((result.savings / (1024 * 1024)).toFixed(4));

  const batch = db.batch();

  // 1. Browser History
  const historyRef = db
    .collection('users').doc(uid)
    .collection('browserHistory').doc();

  batch.set(historyRef, {
    url: result.finalUrl,
    title: result.title || 'Untitled',
    favicon: result.favicon || '',
    domain: extractDomain(result.finalUrl),
    originalSizeKB: Math.round(result.originalSize / 1024),
    compressedSizeKB: Math.round(result.compressedSize / 1024),
    savedKB,
    sessionId: sessionId || generateSessionId(),
    duration: 0, // Updated by client when user leaves page
    visitedAt: now(),
  });

  // 2. Data Usage (daily — upsert with increment)
  const usageRef = db
    .collection('users').doc(uid)
    .collection('dataUsage').doc(today);

  batch.set(usageRef, {
    date: today,
    dateSavedMB: fieldValue().increment(savedMB),
    dataUsedMB: fieldValue().increment(
      parseFloat((result.compressedSize / (1024 * 1024)).toFixed(4))
    ),
    originalDataMB: fieldValue().increment(
      parseFloat((result.originalSize / (1024 * 1024)).toFixed(4))
    ),
    pagesVisited: fieldValue().increment(1),
    [`hourly.${currentHour}`]: fieldValue().increment(savedKB),
    updatedAt: now(),
  }, { merge: true });

  // 3. User aggregate stats
  const userRef = db.collection('users').doc(uid);
  batch.update(userRef, {
    totalDataSavedMB: fieldValue().increment(savedMB),
    lastActiveAt: now(),
    updatedAt: now(),
  });

  // Commit all three writes atomically
  await batch.commit();
}

module.exports = router;
