// ═══════════════════════════════════════════════════════
// /api/stats — Data Usage & Analytics Endpoints (Supabase Client)
// ═══════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();

const { supabase } = require('../config/supabase');
const { successResponse, errorResponse, formatBytes } = require('../utils/helpers');

/**
 * GET /api/stats/dashboard
 *
 * Returns all data needed to render the Dashboard screen in one call.
 * Fetches user profile, streak data, and today's browsing logs to compile aggregates in-memory.
 */
router.get('/dashboard', async (req, res, next) => {
  try {
    const uid = req.uid;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // Parallel fetch
    const [userRes, streakRes, historyRes] = await Promise.all([
      supabase.from('users').select('*').eq('id', uid).maybeSingle(),
      supabase.from('daily_streaks').select('*').eq('user_id', uid).maybeSingle(),
      supabase.from('browser_history')
        .select('saved_kb, original_size_kb, compressed_size_kb, visited_at')
        .eq('user_id', uid)
        .gte('visited_at', todayStart.toISOString())
    ]);

    if (userRes.error) throw userRes.error;
    if (historyRes.error) throw historyRes.error;

    let user = userRes.data;

    // Create user on-the-fly if not found
    if (!user) {
      const { data: newUser, error: createError } = await supabase
        .from('users')
        .insert({
          id: uid,
          email: req.user?.email || 'user@example.com',
          display_name: req.user?.name || 'NetSave User',
          photo_url: req.user?.photo || '',
        })
        .select()
        .single();

      if (createError) throw createError;
      user = newUser;
    }

    const streak = streakRes.data || { current_streak: 0, longest_streak: 0, last_check_in: null };
    const todayHistory = historyRes.data || [];

    // Calculate today's aggregates in-memory
    let todayPagesVisited = todayHistory.length;
    let todaySavedKB = 0;
    let todayUsedKB = 0;
    let todayOriginalKB = 0;
    const hourlyMap = {};

    todayHistory.forEach(item => {
      todaySavedKB += item.saved_kb || 0;
      todayUsedKB += item.compressed_size_kb || 0;
      todayOriginalKB += item.original_size_kb || 0;

      // Extract hour in local timezone
      const hour = new Date(item.visited_at).getHours();
      hourlyMap[hour.toString()] = (hourlyMap[hour.toString()] || 0) + (item.saved_kb || 0);
    });

    const todaySavedMB = parseFloat((todaySavedKB / 1024.0).toFixed(4));
    const todayUsedMB = parseFloat((todayUsedKB / 1024.0).toFixed(4));
    const todayOriginalMB = parseFloat((todayOriginalKB / 1024.0).toFixed(4));

    const compressionRatio = todayOriginalMB > 0
      ? Math.round(((todayOriginalMB - todayUsedMB) / todayOriginalMB) * 100)
      : 0;

    const totalSavedMB = parseFloat(user.total_data_saved_mb || 0);

    return res.json(successResponse({
      profile: {
        displayName: user.display_name || 'User',
        photoURL: user.photo_url || null,
        memberSince: user.created_at,
      },
      balance: {
        coins: user.coins || 0,
        currentStreak: streak.current_streak || 0,
        longest_streak: streak.longest_streak || 0,
      },
      savings: {
        totalDataSavedMB: totalSavedMB,
        totalDataSavedFormatted: formatBytes(totalSavedMB * 1024 * 1024),
        todaySavedMB,
        todaySavedFormatted: formatBytes(todaySavedMB * 1024 * 1024),
        todayPagesVisited,
        compressionRatio,
      },
      activity: {
        hourly: hourlyMap,
      },
      referral: {
        referralCode: user.referral_code || '',
      },
    }, 'Dashboard data loaded'));

  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/stats/usage
 *
 * Retrieve range usage aggregated by date.
 */
router.get('/usage', async (req, res, next) => {
  try {
    const uid = req.uid;
    const range = Math.min(parseInt(req.query.range) || 7, 30);
    
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - range + 1);
    fromDate.setHours(0, 0, 0, 0);

    const { data: history, error } = await supabase
      .from('browser_history')
      .select('saved_kb, original_size_kb, compressed_size_kb, visited_at')
      .eq('user_id', uid)
      .gte('visited_at', fromDate.toISOString())
      .order('visited_at', { ascending: true });

    if (error) throw error;

    // Group history entries by local date (YYYY-MM-DD) in JS
    const daysMap = {};
    
    // Pre-populate range days to ensure we return dates even with 0 visits
    for (let i = 0; i < range; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      daysMap[dateStr] = {
        date: dateStr,
        savedMB: 0,
        usedMB: 0,
        originalMB: 0,
        pagesVisited: 0,
      };
    }

    history.forEach(item => {
      const dateStr = new Date(item.visited_at).toISOString().split('T')[0];
      if (daysMap[dateStr]) {
        daysMap[dateStr].savedMB += item.saved_kb / 1024.0;
        daysMap[dateStr].usedMB += item.compressed_size_kb / 1024.0;
        daysMap[dateStr].originalMB += item.original_size_kb / 1024.0;
        daysMap[dateStr].pagesVisited++;
      }
    });

    // Format & sort chronologically
    const days = Object.values(daysMap)
      .map(day => ({
        ...day,
        savedMB: parseFloat(day.savedMB.toFixed(2)),
        usedMB: parseFloat(day.usedMB.toFixed(2)),
        originalMB: parseFloat(day.originalMB.toFixed(2)),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    let totalSaved = 0;
    let totalUsed = 0;
    let totalOriginal = 0;
    let totalPages = 0;

    days.forEach(day => {
      totalSaved += day.savedMB;
      totalUsed += day.usedMB;
      totalOriginal += day.originalMB;
      totalPages += day.pagesVisited;
    });

    return res.json(successResponse({
      range: { days: range },
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
        daysActive: days.filter(d => d.pagesVisited > 0).length,
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
 * Fetch leaderboards and calculate active user ranking.
 */
router.get('/leaderboard', async (req, res, next) => {
  try {
    const uid = req.uid;
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);

    // Fetch top users sorted by savings
    const { data: topUsers, error: listError } = await supabase
      .from('users')
      .select('id, display_name, photo_url, coins, total_data_saved_mb')
      .order('total_data_saved_mb', { ascending: false })
      .limit(limit);

    if (listError) throw listError;

    const leaders = topUsers.map((user, index) => ({
      rank: index + 1,
      uid: user.id,
      displayName: user.display_name,
      photoURL: user.photo_url,
      coins: user.coins,
      totalSavedMB: parseFloat(user.total_data_saved_mb || 0),
    }));

    // Find rank index of current user
    const { data: allUsers, error: rankError } = await supabase
      .from('users')
      .select('id')
      .order('total_data_saved_mb', { ascending: false });

    if (rankError) throw rankError;

    const userRank = allUsers.findIndex(u => u.id === uid) + 1;

    return res.json(successResponse({
      leaders,
      currentUserRank: userRank || null,
      total: leaders.length,
    }, 'Leaderboard loaded'));

  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/stats/streak
 *
 * Retrieve daily streak check-ins.
 */
router.get('/streak', async (req, res, next) => {
  try {
    const uid = req.uid;
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth() + 1;

    const startOfMonth = new Date(year, month - 1, 1);

    const [streakRes, checkinsRes] = await Promise.all([
      supabase.from('daily_streaks').select('*').eq('user_id', uid).maybeSingle(),
      supabase.from('coins_transactions')
        .select('created_at')
        .eq('user_id', uid)
        .eq('type', 'daily_check_in')
        .gte('created_at', startOfMonth.toISOString())
    ]);

    if (streakRes.error) throw streakRes.error;
    if (checkinsRes.error) throw checkinsRes.error;

    const streak = streakRes.data || { current_streak: 0, longest_streak: 0, last_check_in: null };
    const checkins = checkinsRes.data || [];

    // Format calendar map (e.g. { "24": true, "25": true })
    const daysMap = {};
    checkins.forEach(item => {
      const day = new Date(item.created_at).getDate();
      daysMap[day.toString()] = true;
    });

    const todayDay = new Date().getDate().toString();
    const checkedInToday = daysMap[todayDay] === true;

    return res.json(successResponse({
      currentStreak: streak.current_streak,
      longestStreak: streak.longest_streak,
      lastCheckIn: streak.last_check_in,
      checkedInToday,
      thisMonth: {
        month: `${year}-${month.toString().padStart(2, '0')}`,
        days: daysMap,
        totalCheckIns: checkins.length,
      },
    }, 'Streak details loaded'));

  } catch (err) {
    next(err);
  }
});

module.exports = router;
