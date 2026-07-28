# Realtime: Supabase → Laravel Reverb

We moved the database off Supabase (cross-region latency), which killed the
mobile app's realtime — it subscribed to **Supabase Realtime** (WAL tail of the
Supabase Postgres). This replaces that with **Laravel Reverb**, a self-hosted
WebSocket server co-located with the API on the Forge box. Realtime and the API
now share one stack, one auth (Sanctum), and one host.

## Architecture

```
mobile (laravel-echo + pusher-js)  ──wss──►  nginx :443 /app  ──►  Reverb 127.0.0.1:8080
API (php)  ──http publish──►  Reverb 127.0.0.1:8080  ──►  subscribed clients
mobile ──POST /broadcasting/auth (Bearer)──►  API (Sanctum)  → private-channel authorization
```

### Channel & event contract

| Reverb channel (private) | event (`broadcastAs`) | API broadcaster | Mobile subscriber |
|---|---|---|---|
| `notifications.{userId}` | `notification.created` | `NotificationCreated` | `useRealtimeNotifications` |
| `booking.{bookingId}` | `booking.status` | `BookingStatusChanged`, `BookingCancelled` | `useBookingStatus` |
| `booking.{bookingId}` | `runner.location` | `RunnerLocationUpdated` (ShouldBroadcastNow) | `useRunnerTracking` |
| `runner.{runnerId}` | `booking.incoming` | `IncomingRequest` | `useIncomingRequest` |
| `chat.{bookingId}` | `message.created` | `ChatMessageSent` | `useChat` |
| `chat.{bookingId}` | whisper `typing` | client→client | `useChat` |

Authorizers: `routes/channels.php` (Sanctum-guarded, UUID string compares, participant checks).

## Deploy — API (Forge)

1. **Pull + install deps** (deploy script runs `composer install`; new deps:
   `laravel/reverb`, `pusher/pusher-php-server`).

2. **Generate Reverb credentials once** (writes `REVERB_APP_ID/KEY/SECRET`):
   ```bash
   php artisan reverb:install --no-interaction   # or set the 3 vars by hand
   ```

3. **Set the site `.env`** (Forge → Site → Environment) — see
   `.env.production.example` for the annotated block:
   ```dotenv
   BROADCAST_CONNECTION=reverb
   REVERB_APP_ID=...
   REVERB_APP_KEY=...           # public — also goes in the mobile build
   REVERB_APP_SECRET=...        # secret — server only
   REVERB_HOST=127.0.0.1        # how THIS app publishes to Reverb (loopback)
   REVERB_PORT=8080
   REVERB_SCHEME=http
   REVERB_SERVER_HOST=0.0.0.0   # what `reverb:start` binds
   REVERB_SERVER_PORT=8080
   ```
   Then `php artisan config:clear && php artisan config:cache`.

4. **Run Reverb as a daemon** (Forge → Server → Daemons):
   ```
   Command:   php8.3 artisan reverb:start --host=0.0.0.0 --port=8080
   Directory: /home/forge/<your-site>
   User:      forge
   ```
   Supervisor keeps it alive + restarts on deploy.

5. **nginx path-proxy** (Forge → Site → Edit Nginx Configuration) — reuses the
   existing 443 cert, no new port/DNS. Add inside the `server {}` block:
   ```nginx
   location /app {
       proxy_pass http://127.0.0.1:8080;
       proxy_http_version 1.1;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "Upgrade";
       proxy_read_timeout 60s;
   }
   ```
   Reload nginx. (The API publishes to Reverb over loopback and does NOT go
   through this proxy — only the mobile WebSocket does.)

6. **Queue worker must be running** — `ShouldBroadcast` events (notifications,
   booking status, chat, incoming) are queued. The app already needs a worker
   (SendPushJob etc.); confirm Forge → Site → Queue is active. `RunnerLocationUpdated`
   is `ShouldBroadcastNow` (synchronous) so live tracking doesn't wait on the queue.

7. **Restart** php-fpm + queue after deploy (`php artisan queue:restart`).

## Deploy — Mobile (EAS)

The realtime swap is pure JS (`laravel-echo` + `pusher-js`, Supabase removed),
so it ships **over-the-air** — no store rebuild.

1. Set `EXPO_PUBLIC_REVERB_KEY` in `eas.json` (each profile) to the matching
   environment's `REVERB_APP_KEY`. HOST/PORT/SCHEME are already the public
   domain / 443 / https (path-proxy).
2. `eas update --branch production` (or the target channel). Existing installs
   pick it up on next launch.

## Smoke test

```bash
# On the box: is Reverb up?
curl -si http://127.0.0.1:8080/app/<REVERB_APP_KEY> | head   # 101/426 = alive
# Publicly (through nginx):
curl -si https://<api-domain>/app/<REVERB_APP_KEY> | head
# Auth route reachable with a bearer:
curl -si -X POST https://<api-domain>/broadcasting/auth \
  -H "Authorization: Bearer <token>" -H "Accept: application/json" \
  -d 'channel_name=private-notifications.<uuid>&socket_id=123.456'   # 200 + auth json
```
In-app: open a live trip (runner pin moves), send a chat message (arrives without
the 8s poll), trigger a booking status change (customer/runner update instantly).

## Rollback

Realtime degrades safely: every screen already has a polling fallback. To roll
back, set `BROADCAST_CONNECTION=log` on the API (broadcasts become no-ops) — the
apps fall back to polling automatically. No mobile rollback required.
