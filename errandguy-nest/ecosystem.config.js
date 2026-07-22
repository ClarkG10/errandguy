/**
 * PM2 process model for production (Laravel Forge or any Node host).
 *
 * Two roles from the SAME build:
 *   • errandguy-api    — HTTP, cluster mode (one worker per CPU core) for
 *                        max throughput. Pure request handling: the in-process
 *                        scheduler and queue worker are OFF here so cron sweeps
 *                        never fire N times and workers don't all poll the DB.
 *   • errandguy-worker — a single fork process that OWNS the @Cron reconciliation
 *                        sweeps (auto-cancel, expire-negotiate, ride-duration,
 *                        location cleanup) and drains the DB-backed queue
 *                        (scheduled match/broadcast). Listens on its own port
 *                        (unused by Nginx) so it never clashes with the cluster.
 *
 * The DB queue uses `FOR UPDATE SKIP LOCKED`, so it stays correct even if you
 * later flip QUEUE_ENABLED on the cluster too. The scheduler must stay on ONE
 * process only — keep SCHEDULER_ENABLED=true on exactly one app.
 *
 * Env comes from errandguy-nest/.env (loaded by @nestjs/config from cwd); the
 * per-app `env` block below only sets the role flags and overrides them.
 *
 * Deploy:  pm2 startOrReload ecosystem.config.js --update-env
 * Boot:    pm2 startup systemd  &&  pm2 save
 */
module.exports = {
  apps: [
    {
      name: 'errandguy-api',
      cwd: __dirname,
      script: 'dist/main.js',
      exec_mode: 'cluster',
      instances: 'max', // one per core; set a number (e.g. 2) to cap it
      max_memory_restart: '512M',
      autorestart: true,
      env: {
        NODE_ENV: 'production',
        SCHEDULER_ENABLED: 'false',
        QUEUE_ENABLED: 'false',
      },
    },
    {
      name: 'errandguy-worker',
      cwd: __dirname,
      script: 'dist/main.js',
      exec_mode: 'fork',
      instances: 1,
      max_memory_restart: '512M',
      autorestart: true,
      env: {
        NODE_ENV: 'production',
        SCHEDULER_ENABLED: 'true',
        QUEUE_ENABLED: 'true',
        PORT: '3001', // internal only — Nginx proxies to the cluster on 3000
      },
    },
  ],
};
