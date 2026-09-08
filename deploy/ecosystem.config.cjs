// pm2 process definition for Ambika Global (AGL) ERP.
//
// .cjs on purpose: backend/package.json sets "type": "module", and pm2 reads
// this file with require(). A .js here would be parsed as ESM and throw.
//
// Used with `pm2 startOrReload` (not `pm2 reload`) so the very first deploy
// creates the process instead of failing with "process or namespace not found".
//
// The shared box has ~1.6 GB free across 8 other tenants, so max_memory_restart
// is deliberately conservative — a leak here must not OOM someone else's app.

module.exports = {
  apps: [
    {
      name: 'ambika-backend',
      script: 'src/server.js',
      cwd: '/home/ubuntu/ambika_2.0/backend',
      exec_mode: 'fork',          // matches every other tenant on this box
      instances: 1,
      autorestart: true,
      max_memory_restart: '400M',
      // Give a crash-looping process time to breathe instead of spinning the
      // CPU on a shared host (surgenesis-backend is at 591 restarts).
      min_uptime: '20s',
      max_restarts: 10,
      restart_delay: 4000,
      env: {
        NODE_ENV: 'production',
        PORT: 3006,
      },
      error_file: '/home/ubuntu/.pm2/logs/ambika-backend-error.log',
      out_file:   '/home/ubuntu/.pm2/logs/ambika-backend-out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
