// ═══════════════════════════════════════════════════════
// /api/stats — Data Usage & Analytics Endpoints
// Dashboard stats, daily/weekly/monthly usage
// ═══════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();

const { getDb, now } = require('../config/firebase');
const { successResponse, errorResponse, getTodayIST, formatBytes } = require('../utils/helpers');

/**
 * GET /api/stats/dashboard
 *
 * Returns all data needed to render the Dashboard screen in one call.
 * Optimized to minimize Firestore reads (2 reads total).
 */
router.get('/dashboard', async (req, res, next) => {
  try {
    const uid = req.uid;
    const db = getDb();
    const today = getTodayIST();

    // Parallel reads — user profile + today's usage
    const [userSnap, usageSnap] = await Promise.all([
      db.collection('users').doc(uid).get(),
      db.collection('users').doc(uid)
        .collection('dataUsage').doc(today).get(),
    ]);

    if (!userSnap.exists) {
      return res.status(404).json(
        errorResponse('User profile not found.', 'USER_NOT_FOUND')
      );
    }

    const user = userSnap.data();
    const todayUsage = usageSnap.exists ? usageSnap.data() : null;

    return res.json(successResponse({
      profile: {
        displayName: user.displayName || 'User',
        photoURL: user.photoURL || null,
        memberSince: user.createdAt?.toDate?.() || null,
      },
      balance: {
        coins: user.coins || 0,
        dataBalanceMB: user.dataBalanceMB || 0,
        currentStreak: user.currentStreak || 0,
        longestStreak: user.longestStreak || 0,
      },
      savings: {
        totalDataSavedMB: user.totalDataSavedMB || 0,
        totalDataSavedFormatted: formatBytes((user.totalDataSavedMB || 0) * 1024 * 1024),
        todaySavedMB: todayUsage?.dateSavedMB || 0,
        todaySavedFormatted: formatBytes((todayUsage?.dateSavedMB || 0) * 1024 * 1024),
        todayPagesVisited: todayUsage?.pagesVisited || 0,
        compressionRatio: todayUsage && todayUsage.originalDataMB > 0
          ? Math.round(((todayUsage.originalDataMB - todayUsage.dataUsedMB) / todayUsage.originalDataMB) * 100)
          : 0,
      },
      activity: {
        hourly: todayUsage?.hourly || {},
      },
      referral: {
        referralCode: user.referralCode || '',
        referralCount: user.referralCount || 0,
      },
    }, 'Dashboard data loaded'));

  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/stats/usage
 *
 * Get data usage for a date range.
 *
 * Query params:
 *   ?range=7     - Number of days (default 7, max 30)
 *   ?from=2026-05-20&to=2026-05-26 - Custom date range
 */
router.get('/usage', async (req, res, next) => {
  try {
    const uid = req.uid;
    const db = getDb();

    let fromDate, toDate;
    const today = getTodayIST();

    if (req.query.from && req.query.to) {
      fromDate = req.query.from;
      toDate = req.query.to;
    } else {
      const range = Math.min(parseInt(req.query.range) || 7, 30);
      const from = new Date();
      from.setDate(from.getDate() - range + 1);
      fromDate = from.toISOString().split('T')[0];
      toDate = today;
    }

    // Query dataUsage subcollection by date range
    const snapshot = await db
      .collection('users').doc(uid)
      .collection('dataUsage')
      .where('date', '>=', fromDate)
      .where('date', '<=', toDate)
      .orderBy('date', 'asc')
      .get();

    const days = [];
    let totalSaved = 0;
    let totalUsed = 0;
    let totalOriginal = 0;
    let totalPages = 0;

    snapshot.forEach(doc => {
      const data = doc.data();
      days.push({
        date: data.date,
        savedMB: parseFloat((data.dateSavedMB || 0).toFixed(2)),
        usedMB: parseFloat((data.dataUsedMB || 0).toFixed(2)),
        originalMB: parseFloat((data.originalDataMB || 0).toFixed(2)),
        pagesVisited: data.pagesVisited || 0,
        hourly: data.hourly || {},
      });

      totalSaved += data.dateSavedMB || 0;
      totalUsed += data.dataUsedMB || 0;
      totalOriginal += data.originalDataMB || 0;
      totalPages += data.pagesVisited || 0;
    });

    return res.json(successResponse({
      range: { from: fromDate, to: toDate },
      days,
      summary: {
        totalSavedMB: parseFloat(totalSaved.toFixed(2)),
        totalSavedFormatted: formatBytes(totalSaved * 1024 * 1024),
        totalUsedMB: parseFloat(totalUsed.toFixed(2)),
        totalOriginalMB: parseFloat(totalOriginal.toFixed(2)),
        avgCompressionRatio: totalOriginal > 0
          ? Math.round(((totalOriginal - totalUsed) / totalOriginal) * 100)
          : 0,
        totalPages,
        daysActive: days.length,
        avgSavedPerDay: days.length > 0
          ? parseFloat((totalSaved / days.length).toFixed(2))
          : 0,
      },
    }, `Usage data for ${days.length} days`));

  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/stats/leaderboard
 *
 * Get the global leaderboard (top earners).
 *
 * Query params:
 *   ?limit=10  - Number of entries (default 10, max 50)
 */
router.get('/leaderboard', async (req, res, next) => {
  try {
    const uid = req.uid;
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);

    const snapshot = await db
      .collection('leaderboard')
      .orderBy('totalCoinsEarned', 'desc')
      .limit(limit)
      .get();

    const leaders = [];
    let userRank = null;

    snapshot.forEach((doc, index) => {
      const data = doc.data();
      const entry = {
        rank: data.rank || index + 1,
        uid: doc.id,
        displayName: data.displayName || 'Anonymous',
        photoURL: data.photoURL || null,
        totalCoinsEarned: data.totalCoinsEarned || 0,
        currentStreak: data.currentStreak || 0,
        badges: data.badges || [],
        isCurrentUser: doc.id === uid,
      };

      if (doc.id === uid) {
        userRank = entry;
      }

      leaders.push(entry);
    });

    // If user isn't in top N, fetch their rank separately
    if (!userRank) {
      const userLeaderDoc = await db.collection('leaderboard').doc(uid).get();
      if (userLeaderDoc.exists) {
        const data = userLeaderDoc.data();
        userRank = {
          rank: data.rank || '?',
          uid,
          displayName: data.displayName || 'You',
          totalCoinsEarned: data.totalCoinsEarned || 0,
          currentStreak: data.currentStreak || 0,
          badges: data.badges || [],
          isCurrentUser: true,
        };
      }
    }

    return res.json(successResponse({
      leaders,
      currentUser: userRank,
      total: leaders.length,
    }, 'Leaderboard loaded'));

  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/stats/streak
 *
 * Get current user's streak data for the current month.
 */
router.get('/streak', async (req, res, next) => {
  try {
    const uid = req.uid;
    const db = getDb();

    // Get current month's streak doc + user profile (for streak count)
    const [userSnap, streakSnap] = await Promise.all([
      db.collection('users').doc(uid).get(),
      db.collection('users').doc(uid)
        .collection('dailyStreaks')
        .doc(getTodayIST().slice(0, 7)) // YYYY-MM
        .get(),
    ]);

    const user = userSnap.exists ? userSnap.data() : {};
    const streak = streakSnap.exists ? streakSnap.data() : {};

    // Check if user has checked in today
    const todayDay = new Date().getDate().toString();
    const checkedInToday = streak.days?.[todayDay] === true;

    return res.json(successResponse({
      currentStreak: user.currentStreak || 0,
      longestStreak: user.longestStreak || 0,
      lastCheckIn: user.lastCheckIn?.toDate?.() || null,
      checkedInToday,
      thisMonth: {
        month: streak.month || getTodayIST().slice(0, 7),
        days: streak.days || {},
        totalCheckIns: streak.totalCheckIns || 0,
        coinsEarned: streak.coinsEarned || 0,
      },
    }, 'Streak data loaded'));

  } catch (err) {
    next(err);
  }
});

module.exports = router;
