// ═══════════════════════════════════════════════════════
// Utility Helpers
// ═══════════════════════════════════════════════════════

const { v4: uuidv4 } = require('uuid');

/**
 * Get today's date as YYYY-MM-DD string in IST timezone.
 * @returns {string}
 */
function getTodayIST() {
  const now = new Date();
  const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  return ist.toISOString().split('T')[0];
}

/**
 * Get current hour (0-23) in IST timezone.
 * @returns {number}
 */
function getCurrentHourIST() {
  const now = new Date();
  const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  return ist.getUTCHours();
}

/**
 * Get current month as YYYY-MM string in IST.
 * @returns {string}
 */
function getCurrentMonthIST() {
  const now = new Date();
  const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  return ist.toISOString().slice(0, 7);
}

/**
 * Validate a URL string.
 * @param {string} url
 * @returns {boolean}
 */
function isValidUrl(url) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Normalize a URL (add https:// if missing, trim, lowercase host).
 * @param {string} input
 * @returns {string}
 */
function normalizeUrl(input) {
  let url = input.trim();

  // If no protocol, add https://
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }

  try {
    const parsed = new URL(url);
    parsed.hostname = parsed.hostname.toLowerCase();
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Extract domain from a URL.
 * @param {string} url
 * @returns {string}
 */
function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

/**
 * Convert bytes to a human-readable string.
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
}

/**
 * Generate a unique session ID.
 * @returns {string}
 */
function generateSessionId() {
  return uuidv4();
}

/**
 * Create a standardized API success response.
 */
function successResponse(data, message = 'Success') {
  return {
    success: true,
    message,
    data,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create a standardized API error response.
 */
function errorResponse(message, code = 'ERROR') {
  return {
    success: false,
    error: code,
    message,
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  getTodayIST,
  getCurrentHourIST,
  getCurrentMonthIST,
  isValidUrl,
  normalizeUrl,
  extractDomain,
  formatBytes,
  generateSessionId,
  successResponse,
  errorResponse,
};
