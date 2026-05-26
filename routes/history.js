// ═══════════════════════════════════════════════════════
// /api/history — Browsing History Endpoints (Supabase Client)
// ═══════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();

const { supabase } = require('../config/supabase');
const { successResponse, errorResponse } = require('../utils/helpers');

/**
 * GET /api/history
 *
 * Fetch paginated browsing history for the authenticated user using Supabase client.
 *
 * Query params:
 *   ?limit=20           - Items per page (default 20, max 50)
 *   ?offset=0           - Offset index (default 0)
 *   ?domain=youtube.com - Filter by domain
 *   ?date=2026-05-26    - Filter by specific date (YYYY-MM-DD)
 */
router.get('/', async (req, res, next) => {
  try {
    const uid = req.uid;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const domainFilter = req.query.domain || null;
    const dateFilter = req.query.date || null;

    let queryBuilder = supabase
      .from('browser_history')
      .select('id, url, title, favicon, domain, original_size_kb, compressed_size_kb, saved_kb, session_id, duration, visited_at')
      .eq('user_id', uid)
      .order('visited_at', { ascending: false });

    // ── Domain filter ──
    if (domainFilter) {
      queryBuilder = queryBuilder.eq('domain', domainFilter.toLowerCase());
    }

    // ── Date filter ──
    if (dateFilter) {
      queryBuilder = queryBuilder
        .gte('visited_at', `${dateFilter}T00:00:00.000Z`)
        .lte('visited_at', `${dateFilter}T23:59:59.999Z`);
    }

    // Range-based pagination
    queryBuilder = queryBuilder.range(offset, offset + limit);

    const { data, error } = await queryBuilder;

    if (error) throw error;

    // +1 check for hasMore pagination
    const items = data.slice(0, limit);
    const hasMore = data.length > limit;

    // Map DB names to expected client naming camelCase if needed, but we keep DB output clean
    const formattedItems = items.map(item => ({
      id: item.id,
      url: item.url,
      title: item.title,
      favicon: item.favicon,
      domain: item.domain,
      originalSizeKB: item.original_size_kb,
      compressedSizeKB: item.compressed_size_kb,
      savedKB: item.saved_kb,
      sessionId: item.session_id,
      duration: item.duration,
      visitedAt: item.visited_at,
    }));

    return res.json(successResponse({
      items: formattedItems,
      pagination: {
        limit,
        offset,
        count: formattedItems.length,
        hasMore,
        nextOffset: hasMore ? offset + limit : null,
      },
    }, `Found ${formattedItems.length} history items`));

  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/history/domains
 *
 * Get unique domains visited recently with count and aggregate savings.
 * Performed in-memory to prevent complex database setups on client side.
 */
router.get('/domains', async (req, res, next) => {
  try {
    const uid = req.uid;

    const { data, error } = await supabase
      .from('browser_history')
      .select('domain, favicon, saved_kb, visited_at')
      .eq('user_id', uid)
      .order('visited_at', { ascending: false })
      .limit(200);

    if (error) throw error;

    const domainMap = new Map();

    data.forEach(item => {
      const domain = item.domain || 'unknown';

      if (domainMap.has(domain)) {
        const entry = domainMap.get(domain);
        entry.visitCount++;
        entry.totalSavedKB += item.saved_kb || 0;
      } else {
        domainMap.set(domain, {
          domain,
          favicon: item.favicon || '',
          visitCount: 1,
          totalSavedKB: item.saved_kb || 0,
          lastVisited: item.visited_at,
        });
      }
    });

    // Sort by visit count descending
    const domains = Array.from(domainMap.values())
      .sort((a, b) => b.visitCount - a.visitCount)
      .slice(0, 20);

    return res.json(successResponse({
      domains,
      total: domains.length,
    }, 'Domain summary'));

  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/history/:docId
 *
 * Delete a single history entry.
 */
router.delete('/:docId', async (req, res, next) => {
  try {
    const uid = req.uid;
    const { docId } = req.params;

    if (!docId) {
      return res.status(400).json(
        errorResponse('ID is required.', 'MISSING_ID')
      );
    }

    const { data, error, count } = await supabase
      .from('browser_history')
      .delete()
      .eq('id', docId)
      .eq('user_id', uid)
      .select();

    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(404).json(
        errorResponse('History entry not found.', 'NOT_FOUND')
      );
    }

    return res.json(successResponse(
      { deletedId: docId },
      'History entry deleted'
    ));

  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/history
 *
 * Clear all browsing history for the authenticated user.
 */
router.delete('/', async (req, res, next) => {
  try {
    const uid = req.uid;

    const { data, error } = await supabase
      .from('browser_history')
      .delete()
      .eq('user_id', uid)
      .select();

    if (error) throw error;

    const count = data ? data.length : 0;

    return res.json(successResponse(
      { deletedCount: count },
      `Cleared ${count} history entries`
    ));

  } catch (err) {
    next(err);
  }
});

module.exports = router;
