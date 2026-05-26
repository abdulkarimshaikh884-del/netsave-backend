// ═══════════════════════════════════════════════════════
// Image & HTML Compression Service
// Sharp-based image optimization + HTML simplification
// ═══════════════════════════════════════════════════════

const sharp = require('sharp');
const sanitizeHtml = require('sanitize-html');

// ── Config from env ──
const IMAGE_QUALITY = parseInt(process.env.IMAGE_QUALITY) || 40;
const IMAGE_MAX_WIDTH = parseInt(process.env.IMAGE_MAX_WIDTH) || 800;
const IMAGE_MAX_HEIGHT = parseInt(process.env.IMAGE_MAX_HEIGHT) || 600;

/**
 * Compress an image buffer using Sharp.
 * Converts all images to WebP for maximum savings.
 *
 * @param {Buffer} inputBuffer - Raw image data
 * @param {string} mimeType   - Original MIME type (image/jpeg, image/png, etc.)
 * @returns {Promise<{buffer: Buffer, originalSize: number, compressedSize: number, savings: number}>}
 */
async function compressImage(inputBuffer, mimeType = 'image/jpeg') {
  const originalSize = inputBuffer.length;

  try {
    // Skip tiny images (< 1KB) — compression overhead isn't worth it
    if (originalSize < 1024) {
      return {
        buffer: inputBuffer,
        originalSize,
        compressedSize: originalSize,
        savings: 0,
        format: mimeType,
      };
    }

    const compressed = await sharp(inputBuffer)
      .resize(IMAGE_MAX_WIDTH, IMAGE_MAX_HEIGHT, {
        fit: 'inside',          // Maintain aspect ratio
        withoutEnlargement: true, // Don't upscale small images
      })
      .webp({
        quality: IMAGE_QUALITY,
        effort: 4,               // Balance between speed and compression
        smartSubsample: true,    // Better chroma subsampling
      })
      .toBuffer();

    const compressedSize = compressed.length;

    // If WebP is somehow larger, return original
    if (compressedSize >= originalSize) {
      return {
        buffer: inputBuffer,
        originalSize,
        compressedSize: originalSize,
        savings: 0,
        format: mimeType,
      };
    }

    return {
      buffer: compressed,
      originalSize,
      compressedSize,
      savings: originalSize - compressedSize,
      format: 'image/webp',
    };
  } catch (err) {
    console.error('[COMPRESSION] Image compression failed:', err.message);
    // Return original on failure — never break the page
    return {
      buffer: inputBuffer,
      originalSize,
      compressedSize: originalSize,
      savings: 0,
      format: mimeType,
    };
  }
}

/**
 * Simplify and sanitize HTML content.
 * Removes ads, tracking scripts, heavy iframes, and unnecessary markup.
 *
 * @param {string} html - Raw HTML string
 * @returns {{ cleanHtml: string, originalSize: number, cleanedSize: number, savings: number }}
 */
function simplifyHtml(html) {
  const originalSize = Buffer.byteLength(html, 'utf-8');

  // Step 1: Remove inline scripts, tracking pixels, ad containers
  let cleaned = html
    // Remove all <script> tags and their content
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    // Remove noscript tags
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '')
    // Remove style tags (we'll inject minimal styles)
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    // Remove HTML comments
    .replace(/<!--[\s\S]*?-->/g, '')
    // Remove tracking pixels (1x1 images)
    .replace(/<img[^>]*(?:width|height)\s*=\s*["']?1["']?[^>]*>/gi, '')
    // Remove data-* attributes (tracking data)
    .replace(/\s+data-[\w-]+="[^"]*"/g, '')
    // Remove onclick/onevent handlers
    .replace(/\s+on\w+="[^"]*"/g, '')
    // Remove empty paragraphs and divs
    .replace(/<(p|div|span)\s*>\s*<\/\1>/g, '')
    // Collapse multiple whitespace
    .replace(/\s{2,}/g, ' ')
    // Remove excessive newlines
    .replace(/\n{3,}/g, '\n\n');

  // Step 2: Sanitize with allowlist
  cleaned = sanitizeHtml(cleaned, {
    allowedTags: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'br', 'hr',
      'ul', 'ol', 'li',
      'a', 'img',
      'b', 'strong', 'i', 'em', 'u',
      'blockquote', 'pre', 'code',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'div', 'span', 'section', 'article', 'header', 'footer', 'main', 'nav',
      'figure', 'figcaption',
      'video', 'source',
    ],
    allowedAttributes: {
      'a': ['href', 'title'],
      'img': ['src', 'alt', 'width', 'height', 'loading'],
      'video': ['src', 'poster', 'controls'],
      'source': ['src', 'type'],
      'td': ['colspan', 'rowspan'],
      'th': ['colspan', 'rowspan'],
    },
    // Strip all classes and IDs — we don't need them for display
    allowedClasses: {},
    // Transform tags
    transformTags: {
      // Add lazy loading to all images
      'img': (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, loading: 'lazy' },
      }),
      // Make all links safe
      'a': (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          rel: 'noopener noreferrer',
        },
      }),
    },
  });

  const cleanedSize = Buffer.byteLength(cleaned, 'utf-8');

  return {
    cleanHtml: cleaned,
    originalSize,
    cleanedSize,
    savings: originalSize - cleanedSize,
  };
}

/**
 * Extract readable text content from HTML for ultra-lite mode.
 *
 * @param {string} html - HTML string
 * @returns {string} Plain text content
 */
function extractText(html) {
  return sanitizeHtml(html, {
    allowedTags: [],
    allowedAttributes: {},
  })
    .replace(/\s{2,}/g, ' ')
    .trim();
}

module.exports = {
  compressImage,
  simplifyHtml,
  extractText,
};
