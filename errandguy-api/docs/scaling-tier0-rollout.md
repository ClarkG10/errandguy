# Tier-0 scale rollout — pooler, Redis, OPcache, FPM

**Goal:** carry ~10,000 concurrent users on the *current* Forge box by removing
four infrastructure ceilings — not by adding servers. None of these is an app
rewrite; they are configuration changes plus the small, already-merged code
that makes them safe.

At 10k concurrent the mobile fleet generates **~1,080 req/s** steady state
(~500 of it runner-GPS writes), rising to **~1,830 req/s** if the Reverb realtime
channel drops and clients fall back to REST polling. Today the app hits a wall in the
low hundreds of concurrent because of the items below — long before any CPU/RAM
limit.

> **What's already in the repo** (this PR): pooler-aware `pgsql` + a
> `pgsql_direct` connection (`config/database.php`), migrations pinned to the
> direct connection (`deploy.sh`), documented env (`.env.example`), and the
> Tier-1 app load-reducers (ETag/304 on hot GETs, Xendit-reconcile throttle,
> chat forward-delta, location-only track poll, prod log trimming). Everything
> below is what **you** set on Forge. Nothing here changes behaviour
> until the corresponding env vars are set.

Apply in order. Each step is independently reversible.

---

## 0. Baseline first (so you can prove the win)

Capture before/after for each step:

```bash
# Active Postgres connections (run against the DIRECT endpoint):
#   SELECT count(*), state FROM pg_stat_activity GROUP BY state;
# p95 request time + throughput: Forge → site → nginx access log, or
#   tail -f storage/logs/laravel-*.log | grep 'API Slow Response'
# Cache hit rate after Redis: redis-cli -a "$REDIS_PASSWORD" INFO stats | grep keyspace
```

---

## 1. Connection pooling (PgBouncer) — only if FPM worker count outgrows Postgres max_connections

**Why:** the app connects **directly** to Postgres on `:5432`. Every cold
PHP-FPM worker opens its own connection (+ a fresh TLS/auth handshake per
request, since there's no Octane). With Postgres now co-located on the Forge box
the old cross-region direct-connection cap no longer applies, so this is no
longer the #1 ceiling. If the FPM fleet ever grows enough to approach the local
Postgres `max_connections`, front `pgsql` with a **PgBouncer transaction pool**
on the same box and keep migrations on the unpooled socket.

**Only if needed — set on Forge → site → Environment:**

```dotenv
# pgsql (request traffic) → local PgBouncer transaction pool
DB_HOST=127.0.0.1
DB_PORT=6432                             # PgBouncer's listen port
DB_EMULATE_PREPARES=true                 # required in transaction mode

# pgsql_direct (migrations only) → unpooled Postgres socket
DB_DIRECT_HOST=127.0.0.1
DB_DIRECT_PORT=5432
```

`DB_PASSWORD`, `DB_DATABASE`, `DB_USERNAME`, `DB_SSLMODE` are shared. Point
PgBouncer at `127.0.0.1:5432` as its upstream in `pgbouncer.ini`.

**Deploy** (migrations already run on `pgsql_direct` via `deploy.sh`), then
**verify**:

```bash
php artisan tinker --execute="DB::connection()->select('select 1'); echo 'pool ok';"
php artisan migrate:status --database=pgsql_direct   # DDL path still works
# Under load, pg_stat_activity connection count should stay flat + low.
```

**Rollback:** clear the pooler vars above → `pgsql` falls back to the direct
endpoint exactly as before.

**Caveats:** transaction mode has no session-level state — no `LISTEN/NOTIFY`,
no session advisory locks (the app uses neither). Any future long-lived/DDL
work must use `--database=pgsql_direct`.

---

## 2. Redis for cache + session + queue + rate-limiter

**Why:** `CACHE_STORE=file` routes **every** request's throttle counter and the
`Cache::add` presence/GPS/reconcile latches through flock'd disk I/O — a
serialization point on 100% of traffic. `QUEUE_CONNECTION=database` and
`SESSION_DRIVER=database` pile onto the same Postgres that's the bottleneck.
Redis is already installed and idle (`REDIS_HOST=127.0.0.1`), and
`config/database.php` already defines its connections (cache on DB 1).

**Preconditions:**
- `php -m | grep redis` shows the **phpredis** extension (Forge PHP ships it;
  if absent, enable it or `composer require predis/predis` and set
  `REDIS_CLIENT=predis`).
- `redis-cli -a "$REDIS_PASSWORD" ping` → `PONG`.

**Set on Forge → Environment:**

```dotenv
CACHE_STORE=redis
SESSION_DRIVER=redis
QUEUE_CONNECTION=redis
```

**Add a Redis queue worker** (Forge → site → Queue, or a daemon):

```
php artisan queue:work redis --sleep=1 --tries=3 --max-time=3600
```

Remove/stop the old `database` queue worker so jobs aren't drained from two
stores. `deploy.sh` already issues `queue:restart`.

**Deploy → verify:**

```bash
php artisan tinker --execute="Cache::put('k',1,10); echo Cache::get('k');"   # 1
redis-cli -a "$REDIS_PASSWORD" -n 1 KEYS '*' | head          # cache keys appear
# Fire a booking/top-up → confirm the job runs off the Redis queue.
```

**Rollback:** set the three drivers back to `file`/`database` and restore the
database worker. No data migration needed (caches/sessions are ephemeral; drain
the DB queue before switching if jobs are pending).

---

## 3. OPcache + preload

**Why:** no Octane ⇒ the full framework bootstraps on every request. OPcache
keeps compiled bytecode hot; preload keeps framework classes resident.

**Forge → PHP → edit php.ini (prod pool):**

```ini
opcache.enable=1
opcache.validate_timestamps=0     ; prod: skip mtime checks (deploy clears cache)
opcache.max_accelerated_files=20000
opcache.memory_consumption=256
opcache.interned_strings_buffer=32
```

`deploy.sh` already runs `artisan optimize` (config/route/event cache) and
reloads FPM, which clears OPcache on deploy. Optional: add
`opcache.preload=.../preload.php` (Laravel can generate one) — measure first.

**Verify:** `php -i | grep opcache.enable` and watch p95 TTFB drop on cold
routes. **Rollback:** `opcache.validate_timestamps=1` (or disable).

> Octane (FrankenPHP/Swoole) is the bigger step and is **Tier-2** — it needs a
> static/container-state audit first. Not in this rollout.

---

## 4. PHP-FPM pool sizing

**Why:** FPM must have enough workers to absorb ~1,080 req/s plus bursts, but
not so many that (pre-pooler) they exhaust DB connections or (always) thrash
RAM. With the pooler in place, worker count is bounded by RAM, not the DB.

**Forge → PHP → FPM pool:**

```ini
pm = static                       ; or dynamic with a high pm.max_children
pm.max_children = <RAM_for_PHP / avg_worker_MB>   ; e.g. 6GB/40MB ≈ 150
pm.max_requests = 1000            ; recycle workers to cap leaks
```

Size `pm.max_children` from `ps --no-headers -o rss -C php-fpm | awk '{s+=$1}
END{print s/NR/1024" MB avg"}'`. Keep it comfortably under
(pooler `pool_size` × safety) so a full FPM fleet can't overrun the pooler.

**Verify:** no `server reached pm.max_children` in the FPM log under load;
requests don't queue. **Rollback:** revert the pool values.

---

## Order & smoke test

1. **Redis** (step 2) — lowest risk, immediate per-request win.
2. **Pooler** (step 1) — the real ceiling remover; do at a low-traffic window.
3. **OPcache** (step 3) and **FPM** (step 4) — tune together, watch p95.

After each: run the [baseline](#0-baseline-first-so-you-can-prove-the-win)
queries and a booking → pay → track → complete smoke test on staging. The money
paths are transaction+lock guarded and unchanged by any of this, but verify a
top-up settles and a runner payout credits before/after the queue switch.

## Not in Tier-0 (tracked for later)

- **Location write pipeline → Redis** (read-side): move the nearby-runner
  search onto Redis GEO. *Write-side is already reduced* — the `runner_profiles`
  hot-row UPDATE is now throttled per runner (`LocationService`), since matching
  tolerates a stale position; the remaining Redis step needs a Redis instance to
  build/validate against (none exists locally or in CI today).
- **APM/Sentry**: a per-request DB-query counter now feeds the slow/error log
  (`RequestMetrics`) as the interim "measure" signal. A full APM (Sentry) still
  needs an external DSN — wire it behind env when the account exists.
- **Octane/FrankenPHP**, **RLS-scoped realtime JWT**, **dual-backend decision**
  (never run Laravel + Nest schedulers on one DB).
