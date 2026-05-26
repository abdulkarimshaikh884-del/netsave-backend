// ═══════════════════════════════════════════════════════
// NetSave Backend — Main Server
// Express.js + Puppeteer Cloud Browser for Oracle Cloud
// ═══════════════════════════════════════════════════════

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');

const { supabase } = require('./config/supabase');
// Browser services removed for Render.com compatibility
const { createRateLimiter } = require('./middleware/rateLimiter');
const { authenticate } = require('./middleware/auth');

const browseRoutes = require('./routes/browse');
const historyRoutes = require('./routes/history');
const statsRoutes = require('./routes/stats');

const app = express();
const PORT = process.env.PORT || 3000;

// ═══════ MIDDLEWARE ═══════

// Security headers
app.use(helmet());

// CORS — only allow React Native app
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim());
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, true); // Open for mobile apps — auth handles security
    }
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
}));

// Gzip compression for responses
app.use(compression({
  level: 6,
  threshold: 1024, // Only compress responses > 1KB
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  },
}));

// Body parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Logging
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(':method :url :status :res[content-length] - :response-time ms'));
}

// Global rate limiter
app.use(createRateLimiter({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 30,
}));

// ═══════ HEALTH CHECK (no auth) ═══════

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'netsave-backend',
    version: '1.0.0',
    uptime: Math.floor(process.uptime()),
    memory: {
      used: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
      total: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB`,
    },
    timestamp: new Date().toISOString(),
  });
});

// ═══════ API ROUTES (authenticated) ═══════

app.use('/api/browse', authenticate, browseRoutes);
app.use('/api/history', authenticate, historyRoutes);
app.use('/api/stats', authenticate, statsRoutes);

// ═══════ 404 HANDLER ═══════

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`,
  });
});

// ═══════ GLOBAL ERROR HANDLER ═══════

app.use((err, req, res, _next) => {
  console.error('[ERROR]', {
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    path: req.path,
    method: req.method,
    uid: req.uid || 'anonymous',
    timestamp: new Date().toISOString(),
  });

  const statusCode = err.statusCode || 500;

  res.status(statusCode).json({
    success: false,
    error: err.name || 'InternalServerError',
    message: process.env.NODE_ENV === 'development'
      ? err.message
      : 'Something went wrong. Please try again.',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

// ═══════ STARTUP ═══════

async function startServer() {
  try {
    console.log('╔═══════════════════════════════════════╗');
    console.log('║     🚀 NetSave Backend Starting...    ║');
    console.log('╚═══════════════════════════════════════╝');

    // 1. Verify Supabase Configuration
    console.log('[INIT] Verifying Supabase configuration...');
    if (supabase) {
      console.log('[INIT] ✅ Supabase Client connected');
    }

    // 2. Puppeteer browser omitted for Render.com compatibility
    console.log('[INIT] Optional Puppeteer browser initialization skipped');

    // 3. Start Express server
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`[INIT] ✅ Server running on port ${PORT}`);
      console.log(`[INIT] ✅ Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log('╔═══════════════════════════════════════╗');
      console.log('║    ✅ NetSave Backend Ready!           ║');
      console.log('╚═══════════════════════════════════════╝');
    });

    // Graceful shutdown
    const shutdown = async (signal) => {
      console.log(`\n[SHUTDOWN] Received ${signal}. Cleaning up...`);

      server.close(() => {
        console.log('[SHUTDOWN] HTTP server closed');
      });

      // Puppeteer cleanup skipped
      console.log('[SHUTDOWN] Optional browser cleanup skipped');

      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Unhandled errors
    process.on('unhandledRejection', (reason, promise) => {
      console.error('[FATAL] Unhandled Rejection:', reason);
    });

    process.on('uncaughtException', (err) => {
      console.error('[FATAL] Uncaught Exception:', err);
      process.exit(1);
    });

  } catch (err) {
    console.error('[FATAL] Failed to start server:', err);
    process.exit(1);
  }
}

startServer();

module.exports = app;
