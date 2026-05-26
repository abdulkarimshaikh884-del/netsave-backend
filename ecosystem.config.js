// ═══════════════════════════════════════════════════════
// PM2 Process Manager Config — Oracle Cloud Free Tier
// 1 OCPU + 1 GB RAM — conservative settings
// ═══════════════════════════════════════════════════════

module.exports = {
  apps: [
    {
      name: 'netsave-backend',
      script: './server.js',
      instances: 1, // Single instance (1GB RAM limit)
      exec_mode: 'fork',

      // ── Memory & Restart ──
      max_memory_restart: '700M', // Restart if exceeds 700MB (leave room for OS)
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,

      // ── Environment ──
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },

      // ── Logs ──
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/error.log',
      out_file: './logs/output.log',
      merge_logs: true,
      log_type: 'json',

      // ── Graceful Shutdown ──
      kill_timeout: 10000,
      listen_timeout: 10000,
    },
  ],
};
