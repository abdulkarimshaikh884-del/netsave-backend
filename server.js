// ═══════════════════════════════════════════
// NetSave Backend — Express + Supabase + Puppeteer
// Hugging Face Docker Spaces Ready | CommonJS
// ═══════════════════════════════════════════

const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const puppeteer = require('puppeteer');
const fetch = require('node-fetch');

// ── Env Check ──
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const PORT = process.env.PORT || 7860; // Hugging Face default port is 7860

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
// 0. GET / — Root route
// ═══════════════════════════════════════════
app.get('/', (req, res) => {
  res.json({
    app: 'NetSave Backend',
    status: 'running',
    version: '1.0.0',
    endpoints: ['/health', '/browse', '/history/:userId', '/coins/add'],
  });
});

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
// 2. POST /browse — Lightweight Fetch & Compress
// ═══════════════════════════════════════════
app.post('/browse', async (req, res) => {
  try {
    const { url, userId } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });

    // URL fix
    let fullUrl = url;
    if (!fullUrl.startsWith('http')) fullUrl = 'https://' + fullUrl;

    const startTime = Date.now();

    // Page fetch karo
    const response = await fetch(fullUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36',
        'Accept': 'text/html',
        'Accept-Encoding': 'gzip, deflate',
      },
      timeout: 15000,
      follow: 5,
    });

    const html = await response.text();
    const originalSize = Buffer.byteLength(html, 'utf8');

    // Basic compression — remove scripts, styles, comments
    let compressed = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    // Extract title
    const titleMatch = compressed.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : fullUrl;

    // Extract readable text
    const textContent = compressed
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .substring(0, 5000);

    const compressedSize = Buffer.byteLength(textContent, 'utf8');
    const dataSaved = Math.max(0, originalSize - compressedSize);
    const loadTime = Date.now() - startTime;

    // Save to Supabase history
    if (userId && userId !== 'guest') {
      try {
        await supabase.from('browser_history').insert({
          user_id: userId,
          url: fullUrl,
          title: title,
          data_saved: dataSaved,
          visited_at: new Date().toISOString(),
        });
      } catch(e) { /* ignore */ }
    }

    res.json({
      success: true,
      title,
      content: textContent,
      originalSize,
      compressedSize,
      dataSaved,
      loadTime,
      url: fullUrl,
    });

  } catch (err) {
    res.status(500).json({ 
      error: 'Could not load page',
      message: err.message 
    });
  }
});

// ═══════════════════════════════════════════
// 3. POST /stream-video — Low-bandwidth 144p YouTube Link Extractor
// ═══════════════════════════════════════════
app.post('/stream-video', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'YouTube URL is required' });
  }

  try {
    const streamInfo = await getYouTube144pStream(url);
    res.json({
      success: true,
      title: streamInfo.title,
      streamUrl: streamInfo.streamUrl,
      quality: streamInfo.quality,
      mimeType: streamInfo.mimeType,
      videoId: streamInfo.videoId
    });
  } catch (err) {
    console.error('YouTube stream resolve error:', err);
    res.status(500).json({ error: 'Could not extract 144p stream: ' + err.message });
  }
});

// ═══════════════════════════════════════════
// YouTube Link Extractor Engine Helpers
// ═══════════════════════════════════════════
async function getYouTube144pStream(url) {
  let videoId = '';
  const match = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i);
  if (match) {
    videoId = match[1];
  } else {
    throw new Error('Invalid YouTube URL');
  }

  // 1. Try direct watch page scraping first
  try {
    return await getDirectStream(videoId);
  } catch (err) {
    console.log('[NetSave Extractor] Direct extraction failed, attempting Invidious API pools...');
    
    // 2. Try Invidious public instance API fallbacks
    const instances = [
      'https://vid.priv.au',
      'https://invidious.lunar.icu',
      'https://iv.melmac.space',
      'https://invidious.projectsegfau.lt'
    ];

    for (const base of instances) {
      try {
        const response = await fetch(`${base}/api/v1/videos/${videoId}`);
        if (response.ok) {
          const data = await response.json();
          const title = data.title || 'YouTube Video';
          const formatStreams = data.formatStreams || [];
          
          // Match lowest video stream (144p or 240p)
          let stream = formatStreams.find(s => s.quality === '144p' || s.resolution === '144p');
          if (!stream && formatStreams.length > 0) {
            stream = formatStreams[0]; // fallback lowest quality
          }
          if (stream && stream.url) {
            return {
              title,
              streamUrl: stream.url,
              quality: stream.quality || '144p',
              mimeType: stream.container ? `video/${stream.container}` : 'video/mp4',
              videoId
            };
          }
        }
      } catch (e) {
        console.warn(`[NetSave Extractor] Failed Invidious base ${base}:`, e.message);
      }
    }

    throw new Error('Failed to resolve 144p stream link from all sources.');
  }
}

async function getDirectStream(videoId) {
  const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    }
  });
  const html = await response.text();

  const playerResponseRegex = /ytInitialPlayerResponse\s*=\s*({.+?});/i;
  const playerMatch = html.match(playerResponseRegex);
  
  let playerJsonStr = '';
  if (playerMatch) {
    playerJsonStr = playerMatch[1];
  } else {
    const altRegex = /window\["ytInitialPlayerResponse"\]\s*=\s*({.+?});/i;
    const altMatch = html.match(altRegex);
    if (!altMatch) {
      throw new Error('ytInitialPlayerResponse player structure not found');
    }
    playerJsonStr = altMatch[1];
  }

  const data = JSON.parse(playerJsonStr);
  const title = data.videoDetails?.title || 'YouTube Video';
  
  if (!data.streamingData) {
    throw new Error('No streamingData block found in page payload');
  }

  const formats = [
    ...(data.streamingData.formats || []),
    ...(data.streamingData.adaptiveFormats || [])
  ];

  // Try to find the 144p itag 17 (3gp, ultra low bandwidth) or itag 36, or any 144p format
  let format144p = formats.find(f => 
    f.url && 
    (f.qualityLabel === '144p' || f.height === 144 || f.itag === 17 || f.itag === 36)
  );

  // Fallback to low resolution mp4 streams (like 360p itag 18)
  if (!format144p) {
    format144p = formats.find(f => f.url && f.mimeType && f.mimeType.includes('video/mp4'));
  }

  if (!format144p) {
    format144p = formats.find(f => f.url);
  }

  if (!format144p) {
    throw new Error('No direct stream url found (possibly signature cipher required)');
  }

  return {
    title,
    streamUrl: format144p.url,
    quality: format144p.qualityLabel || '144p',
    mimeType: format144p.mimeType,
    videoId
  };
}

// ═══════════════════════════════════════════
// 4. GET /history/:userId
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
// 5. POST /coins/add
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
