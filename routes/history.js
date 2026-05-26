// ═══════════════════════════════════════════════════════
// /api/history — Browsing History Endpoints
// CRUD for user's cloud browsing history
// ═══════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();

const { getDb, now } = require('../config/firebase');
const { successResponse, errorResponse, getTodayIST } = require('../utils/helpers');

/**
 * GET /api/history
 *
 * Fetch paginated browsing history for the authenticated user.
 *
 * Query params:
 *   ?limit=20           - Items per page (default 20, max 50)
 *   ?startAfter=docId   - Cursor for pagination
 *   ?domain=youtube.com - Filter by domain
 *   ?date=2026-05-26    - Filter by specific date
 */
router.get('/', async (req, res, next) => {
  try {
    const uid = req.uid;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const startAfter = req.query.startAfter || null;
    const domainFilter = req.query.domain || null;
    const dateFilter = req.query.date || null;

    const db = getDb();
    let query = db
      .collection('users').doc(uid)
      .collection('browserHistory')
      .orderBy('visitedAt', 'desc');

    // ── Domain filter ──
    if (domainFilter) {
      query = query.where('domain', '==', domainFilter.toLowerCase());
    }

    // ── Date filter ──
    if (dateFilter) {
      const startOfDay = new Date(dateFilter + 'T00:00:00+05:30');
      const endOfDay = new Date(dateFilter + 'T23:59:59+05:30');

      query = query
        .where('visitedAt', '>=', startOfDay)
        .where('visitedAt', '<=', endOfDay);
    }

    // ── Pagination cursor ──
    if (startAfter) {
      const lastDoc = await db
        .collection('users').doc(uid)
        .collection('browserHistory').doc(startAfter)
        .get();

      if (lastDoc.exists) {
        query = query.startAfter(lastDoc);
      }
    }

    // ── Execute ──
    const snapshot = await query.limit(limit + 1).get(); // +1 to check hasMore

    const items = [];
    const docs = snapshot.docs.slice(0, limit);

    docs.forEach(doc => {
      items.push({
        id: doc.id,
        ...doc.data(),
        visitedAt: doc.data().visitedAt?.toDate?.() || null,
      });
    });

    const hasMore = snapshot.docs.length > limit;
    const nextCursor = hasMore ? docs[docs.length - 1]?.id : null;

    return res.json(successResponse({
      items,
      pagination: {
        limit,
        count: items.length,
        hasMore,
        nextCursor,
      },
    }, `Found ${items.length} history items`));

  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/history/domains
 *
 * Get a summary of unique domains visited with visit counts.
 * Useful for the "top sites" view in the browser screen.
 */
router.get('/domains', async (req, res, next) => {
  try {
    const uid = req.uid;
    const db = getDb();

    // Get recent history (last 200 entries) and aggregate client-side
    // This is cheaper than a Firestore aggregation query
    const snapshot = await db
      .collection('users').doc(uid)
      .collection('browserHistory')
      .orderBy('visitedAt', 'desc')
      .limit(200)
      .get();

    const domainMap = new Map();

    snapshot.forEach(doc => {
      const data = doc.data();
      const domain = data.domain || 'unknown';

      if (domainMap.has(domain)) {
        const entry = domainMap.get(domain);
        entry.visitCount++;
        entry.totalSavedKB += data.savedKB || 0;
      } else {
        domainMap.set(domain, {
          domain,
          favicon: data.favicon || '',
          visitCount: 1,
          totalSavedKB: data.savedKB || 0,
          lastVisited: data.visitedAt?.toDate?.() || null,
        });
      }
    });

    // Sort by visit count descending
    const domains = Array.from(domainMap.values())
      .sort((a, b) => b.visitCount - a.visitCount)
      .slice(0, 20); // Top 20 domains

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
        errorResponse('Document ID is required.', 'MISSING_DOC_ID')
      );
    }

    const db = getDb();
    const docRef = db
      .collection('users').doc(uid)
      .collection('browserHistory').doc(docId);

    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json(
        errorResponse('History entry not found.', 'NOT_FOUND')
      );
    }

    await docRef.delete();

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
 * Uses batched deletes for efficiency.
 */
router.delete('/', async (req, res, next) => {
  try {
    const uid = req.uid;
    const db = getDb();
    const collectionRef = db
      .collection('users').doc(uid)
      .collection('browserHistory');

    let totalDeleted = 0;

    // Delete in batches of 100 (Firestore batch limit: 500)
    const deleteInBatches = async () => {
      const snapshot = await collectionRef.limit(100).get();

      if (snapshot.empty) return;

      const batch = db.batch();
      snapshot.forEach(doc => {
        batch.delete(doc.ref);
        totalDeleted++;
      });

      await batch.commit();

      // If we got exactly 100, there might be more
      if (snapshot.size === 100) {
        await deleteInBatches();
      }
    };

    await deleteInBatches();

    return res.json(successResponse(
      { deletedCount: totalDeleted },
      `Cleared ${totalDeleted} history entries`
    ));

  } catch (err) {
    next(err);
  }
});

module.exports = router;
