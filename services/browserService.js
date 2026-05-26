// ═══════════════════════════════════════════════════════
// Puppeteer Browser Service (Stubbed for Render.com)
// ═══════════════════════════════════════════════════════

async function initBrowser() {
  console.log('[BROWSER] Stubbed initBrowser: Puppeteer is disabled.');
  return;
}

async function closeBrowser() {
  console.log('[BROWSER] Stubbed closeBrowser: Puppeteer is disabled.');
  return;
}

async function fetchPage() {
  throw new Error('Browser feature unavailable');
}

function getBrowserStatus() {
  return {
    isRunning: false,
    activePages: 0,
    maxPages: 0,
  };
}

module.exports = {
  initBrowser,
  closeBrowser,
  fetchPage,
  getBrowserStatus,
};
