// ═══════════════════════════════════════════════════════
// Puppeteer Browser Service
// Manages a shared Chromium instance for cloud browsing
// Handles page fetching, image interception, compression
// ═══════════════════════════════════════════════════════

const puppeteer = process.env.PUPPETEER_SKIP_DOWNLOAD === 'true' ? null : require('puppeteer');
const { compressImage, simplifyHtml } = require('./compressionService');

// ── Config ──
const MAX_PAGES = parseInt(process.env.PUPPETEER_MAX_PAGES) || 3;
const TIMEOUT = parseInt(process.env.PUPPETEER_TIMEOUT_MS) || 15000;
const NAV_TIMEOUT = parseInt(process.env.PUPPETEER_NAVIGATION_TIMEOUT_MS) || 20000;

// ── State ──
let browser = null;
let activePages = 0;

// Blocked resource types and domains (ads, trackers, heavy assets)
const BLOCKED_RESOURCE_TYPES = new Set([
  'font',           // Fonts are heavy and not essential
  'media',          // Video/audio auto-play
  'websocket',      // Real-time connections waste data
]);

const BLOCKED_DOMAINS = [
  'google-analytics.com',
  'googletagmanager.com',
  'facebook.net',
  'fbcdn.net',
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'adnxs.com',
  'adsrvr.org',
  'amazon-adsystem.com',
  'hotjar.com',
  'mixpanel.com',
  'segment.com',
  'optimizely.com',
  'newrelic.com',
  'sentry.io',
  'clarity.ms',
];

/**
 * Launch a shared Puppeteer browser instance.
 * Configured for Oracle Cloud Free Tier (1GB RAM).
 */
async function initBrowser() {
  if (process.env.PUPPETEER_SKIP_DOWNLOAD === 'true') {
    console.log('[BROWSER] Optional browser: PUPPETEER_SKIP_DOWNLOAD is true. Skipping browser startup.');
    return;
  }
  if (browser) return;

  browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',      // Use /tmp instead of /dev/shm (limited in containers)
      '--disable-gpu',                 // No GPU on Oracle Cloud
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-default-apps',
      '--disable-sync',
      '--disable-translate',
      '--metrics-recording-only',
      '--no-first-run',
      '--safebrowsing-disable-auto-update',
      '--single-process',             // Save memory on 1GB RAM
      '--disable-features=site-per-process', // Reduce process count
      '--js-flags=--max-old-space-size=256', // Limit V8 heap
    ],
    // Keep browser alive across requests
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  });

  // Auto-restart if browser crashes
  browser.on('disconnected', () => {
    console.warn('[BROWSER] Browser disconnected. Restarting...');
    browser = null;
    activePages = 0;
    initBrowser().catch(err => {
      console.error('[BROWSER] Failed to restart:', err.message);
    });
  });

  console.log(`[BROWSER] Launched (max ${MAX_PAGES} concurrent pages)`);
}

/**
 * Close the shared browser instance.
 */
async function closeBrowser() {
  if (process.env.PUPPETEER_SKIP_DOWNLOAD === 'true') {
    return;
  }
  if (browser) {
    await browser.close();
    browser = null;
    activePages = 0;
    console.log('[BROWSER] Closed');
  }
}

/**
 * Fetch a URL through the cloud browser with full compression.
 *
 * @param {string} url             - URL to browse
 * @param {Object} options
 * @param {string} options.mode    - "full" | "lite" | "text"
 * @param {number} options.imageQuality - Image compression quality (1-100)
 * @returns {Promise<BrowseResult>}
 */
async function fetchPage(url, options = {}) {
  const { mode = 'full', imageQuality } = options;

  if (process.env.PUPPETEER_SKIP_DOWNLOAD === 'true') {
    throw Object.assign(
      new Error('Browser feature not available on this server'),
      { statusCode: 503 }
    );
  }

  // ── Guard: Max concurrent pages ──
  if (activePages >= MAX_PAGES) {
    throw Object.assign(
      new Error(`Server busy. ${MAX_PAGES} pages already loading. Try again shortly.`),
      { statusCode: 503 }
    );
  }

  if (!browser) {
    await initBrowser();
  }

  activePages++;
  let page = null;

  const result = {
    url,
    finalUrl: url,
    title: '',
    favicon: '',
    html: '',
    text: '',
    originalSize: 0,
    compressedSize: 0,
    savings: 0,
    compressionRatio: 0,
    imagesCompressed: 0,
    totalImageSavings: 0,
    blockedRequests: 0,
    loadTimeMs: 0,
    mode,
  };

  const startTime = Date.now();

  try {
    page = await browser.newPage();

    // ── Viewport (mobile-first) ──
    await page.setViewport({ width: 375, height: 812, isMobile: true });

    // ── User Agent (mobile Chrome) ──
    await page.setUserAgent(
      'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
    );

    // ── Disable JavaScript in lite/text mode ──
    if (mode === 'lite' || mode === 'text') {
      await page.setJavaScriptEnabled(false);
    }

    // ── Request Interception ──
    await page.setRequestInterception(true);

    let totalOriginalImageSize = 0;
    let totalCompressedImageSize = 0;
    let imageCount = 0;
    let blockedCount = 0;

    // Track all image responses for compression
    const imageBuffers = new Map();

    page.on('request', (request) => {
      const resourceType = request.resourceType();
      const requestUrl = request.url();

      // Block unwanted resource types
      if (BLOCKED_RESOURCE_TYPES.has(resourceType)) {
        blockedCount++;
        request.abort();
        return;
      }

      // Block ads & trackers by domain
      const isBlocked = BLOCKED_DOMAINS.some(domain => requestUrl.includes(domain));
      if (isBlocked) {
        blockedCount++;
        request.abort();
        return;
      }

      // In text mode, block images too
      if (mode === 'text' && resourceType === 'image') {
        blockedCount++;
        request.abort();
        return;
      }

      // Block stylesheets in text mode
      if (mode === 'text' && resourceType === 'stylesheet') {
        blockedCount++;
        request.abort();
        return;
      }

      request.continue();
    });

    // ── Track response sizes ──
    page.on('response', async (response) => {
      try {
        const contentType = response.headers()['content-type'] || '';
        const responseUrl = response.url();

        if (contentType.startsWith('image/') && mode !== 'text') {
          const buffer = await response.buffer();
          totalOriginalImageSize += buffer.length;
          imageBuffers.set(responseUrl, {
            buffer,
            mimeType: contentType.split(';')[0],
          });
        }
      } catch {
        // Response might have been aborted — silently ignore
      }
    });

    // ── Navigate ──
    const response = await page.goto(url, {
      waitUntil: mode === 'text' ? 'domcontentloaded' : 'networkidle2',
      timeout: NAV_TIMEOUT,
    });

    if (!response) {
      throw Object.assign(
        new Error('Page failed to load — no response received.'),
        { statusCode: 502 }
      );
    }

    const statusCode = response.status();
    if (statusCode >= 400) {
      throw Object.assign(
        new Error(`Page returned HTTP ${statusCode}`),
        { statusCode: 502 }
      );
    }

    // ── Wait briefly for dynamic content ──
    if (mode === 'full') {
      await page.waitForTimeout(1500);
    }

    // ── Extract page data ──
    result.finalUrl = page.url();
    result.title = await page.title();

    // Get favicon
    try {
      result.favicon = await page.evaluate(() => {
        const link = document.querySelector('link[rel~="icon"]')
          || document.querySelector('link[rel="shortcut icon"]');
        return link ? link.href : '';
      });
    } catch {
      result.favicon = '';
    }

    // ── Get HTML content ──
    const rawHtml = await page.content();
    result.originalSize = Buffer.byteLength(rawHtml, 'utf-8');

    // ── Process based on mode ──
    if (mode === 'text') {
      // Text-only mode: extract readable text
      result.text = await page.evaluate(() => {
        const article = document.querySelector('article')
          || document.querySelector('[role="main"]')
          || document.querySelector('main')
          || document.body;
        return article ? article.innerText : document.body.innerText;
      });

      result.compressedSize = Buffer.byteLength(result.text, 'utf-8');

    } else {
      // Full/Lite mode: simplify HTML
      const { cleanHtml, cleanedSize } = simplifyHtml(rawHtml);
      result.html = cleanHtml;
      result.compressedSize = cleanedSize;
    }

    // ── Compress images ──
    if (mode !== 'text' && imageBuffers.size > 0) {
      const compressionPromises = [];

      for (const [imgUrl, { buffer, mimeType }] of imageBuffers) {
        compressionPromises.push(
          compressImage(buffer, mimeType).then(compressed => {
            if (compressed.savings > 0) {
              imageCount++;
              totalCompressedImageSize += compressed.compressedSize;
            } else {
              totalCompressedImageSize += compressed.originalSize;
            }
            return { url: imgUrl, ...compressed };
          })
        );
      }

      const compressedImages = await Promise.all(compressionPromises);
      result.imagesCompressed = imageCount;
      result.totalImageSavings = totalOriginalImageSize - totalCompressedImageSize;

      // Add image savings to total
      result.originalSize += totalOriginalImageSize;
      result.compressedSize += totalCompressedImageSize;
    }

    // ── Calculate totals ──
    result.savings = result.originalSize - result.compressedSize;
    result.compressionRatio = result.originalSize > 0
      ? Math.round((result.savings / result.originalSize) * 100)
      : 0;
    result.blockedRequests = blockedCount;
    result.loadTimeMs = Date.now() - startTime;

    console.log(`[BROWSE] ${url} → ${result.compressionRatio}% saved (${(result.savings / 1024).toFixed(1)}KB)`);

    return result;

  } catch (err) {
    // Attach timing even on error
    result.loadTimeMs = Date.now() - startTime;

    // Rethrow with context
    if (!err.statusCode) err.statusCode = 500;
    throw err;

  } finally {
    // Always close the page and decrement counter
    if (page) {
      try {
        await page.close();
      } catch {
        // Page might already be closed
      }
    }
    activePages = Math.max(0, activePages - 1);
  }
}

/**
 * Get current browser status.
 * @returns {{ isRunning: boolean, activePages: number, maxPages: number }}
 */
function getBrowserStatus() {
  return {
    isRunning: browser !== null,
    activePages,
    maxPages: MAX_PAGES,
  };
}

module.exports = {
  initBrowser,
  closeBrowser,
  fetchPage,
  getBrowserStatus,
};
