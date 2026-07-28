# Admin panel is slow — diagnosis & fix

## TL;DR
The Filament admin taking 5–10s per page is **not a Filament problem and not a code
problem** — the resource tables are already eager-loaded, filters use static options,
dashboard widgets are Redis-cached, and the Bookings table has only ~31 rows.

The bottleneck is **network distance between the Forge app server and the Supabase
database (different regions)**. Every PHP-FPM request opens a fresh DB connection, and:

```
connect + TLS + SCRAM auth:   ~1168 ms   ← paid on EVERY request (share-nothing FPM)
trivial COUNT query:           ~314 ms
bookings page query (25 rows): ~1381 ms   ← one round-trip per eager-loaded relation
```

Rewriting the admin in React/TypeScript would **not** help — a React SPA calls a Laravel
API on the same Forge box that opens the same 1.2s connection to the same distant DB.

## Fixes, by impact

### 1. Co-locate the app server and the database (the real fix — 10× win)
Put Forge and Supabase in the **same cloud region**. Easiest path: create a new Forge
server in the region of the Supabase project, deploy, cut over. This turns ~1.2s
connects into ~50ms and ~150ms queries into ~5ms → 5–10s pages become sub-500ms.

### 2. Persistent DB connections (stopgap while cross-region — done in code, off by default)
`config/database.php` now supports `DB_PERSISTENT`. Enabling it reuses each FPM worker's
DB socket across requests, so only the *first* request per worker pays the ~1.2s
handshake instead of every request. Set in the Forge site `.env`:

```
DB_PERSISTENT=true
DB_EMULATE_PREPARES=true   # required with the transaction pooler; confirm it's set
```

Then reload FPM (Forge → site → "Restart"/deploy). Reversible: set `DB_PERSISTENT=false`.

### 3. Filament caches on deploy (done in code)
`deploy.sh` now runs `php artisan filament:optimize` (caches the component registry +
Blade icon manifest — `php artisan optimize` alone does not cover these).

### 4. OPcache tuning on the Forge box (php.ini) — for Filament's large file count
Edit the FPM php.ini (Forge → server → PHP → `php.ini`), then restart FPM:

```ini
opcache.enable=1
opcache.memory_consumption=256
opcache.interned_strings_buffer=32
opcache.max_accelerated_files=30000     ; Filament + Livewire ship thousands of files
opcache.validate_timestamps=0           ; prod only — revalidate on deploy, not per request
```

`opcache.validate_timestamps=0` means code changes are picked up only after an FPM
reload — the deploy already reloads FPM, so this is safe in prod.

## Verify on the Forge box
Run this on the server to see the *real* prod-perspective latency (settles it definitively):

```bash
php artisan tinker --execute='
$t=microtime(true); DB::connection()->getPdo(); printf("connect: %.0f ms\n",(microtime(true)-$t)*1000);
$t=microtime(true); DB::table("bookings")->count(); printf("query:   %.0f ms\n",(microtime(true)-$t)*1000);'
```

If `connect` is ~1s, it's the cross-region tax → do #1 (and #2 as a stopgap).
If `connect` is <50ms, the regions are already close and the cause is elsewhere.
