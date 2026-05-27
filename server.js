// ═══════════════════════════════════════════
// NetSave Backend — Simple Express + Supabase
// Render.com Ready | CommonJS
// ═══════════════════════════════════════════

const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');

// ── Env Check ──
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const PORT = process.env.PORT || 3000;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  process.exit(1);
}

// ── Supabase Client ──
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
  realtime: { transport: ws },
});

// ── Express App ──
const app = express();
app.use(cors());
app.use(express.json());

// ═══════════════════════════════════════════
// 1. GET /health
// ═══════════════════════════════════════════
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'netsave-backend',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// ═══════════════════════════════════════════
// 2. POST /browse — disabled (no Puppeteer)
// ═══════════════════════════════════════════
app.post('/browse', (req, res) => {
  res.status(503).json({ error: 'not available' });
});

// ═══════════════════════════════════════════
// 3. GET /history/:userId
// ═══════════════════════════════════════════
app.get('/history/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);

    const { data, error } = await supabase
      .from('browser_history')
      .select('*')
      .eq('user_id', userId)
      .order('visited_at', { ascending: false })
      .limit(limit);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ history: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════
// 4. POST /coins/add
// ═══════════════════════════════════════════
app.post('/coins/add', async (req, res) => {
  try {
    const { user_id, amount, type } = req.body;

    if (!user_id || !amount || !type) {
      return res.status(400).json({ error: 'user_id, amount, type are required' });
    }

    // 1. Insert transaction record
    const { error: txnError } = await supabase
      .from('coins_transactions')
      .insert({ user_id, amount, type });

    if (txnError) {
      return res.status(500).json({ error: txnError.message });
    }

    // 2. Update user coin balance
    const { data: user, error: fetchError } = await supabase
      .from('users')
      .select('coins')
      .eq('id', user_id)
      .single();

    if (fetchError) {
      return res.status(500).json({ error: fetchError.message });
    }

    const newBalance = (user.coins || 0) + amount;

    const { error: updateError } = await supabase
      .from('users')
      .update({ coins: newBalance })
      .eq('id', user_id);

    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }

    res.json({ success: true, balance: newBalance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════
// Start Server
// ═══════════════════════════════════════════
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ NetSave backend running on port ${PORT}`);
});
