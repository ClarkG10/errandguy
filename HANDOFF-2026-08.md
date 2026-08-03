# Handoff / Deploy follow-ups — 2026-08

Consolidated checklist for the work landed this session (realtime fix, full
Supabase removal, social-login removal, asset checkerboard cleanup). Everything
**code-side is committed and pushed to `main`**; the items below are the parts
that live **off-repo** (server env, third-party consoles) or need a **designer**.

---

## 1. Server-side — Forge Site `.env` (prod)

These live in the Forge Site `.env`, not the repo, so they must be set on the box.

- [ ] **DB is off Supabase.** Confirm `DB_*` points at the Forge-managed Postgres,
      not `db.jzdaqibkikflhuioptkg.supabase.co`:
      ```
      DB_CONNECTION=pgsql
      DB_HOST=127.0.0.1        # Forge-local Postgres
      DB_PORT=5432
      DB_DATABASE=<forge db>
      DB_USERNAME=forge
      DB_PASSWORD=<forge pw>
      DB_SSLMODE=prefer
      ```
      ⚠️ If prod data still physically sits on Supabase, this needs a real
      `pg_dump` → restore onto the Forge Postgres **first** — an env swap alone
      would point at an empty DB.
- [ ] **Remove** `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` from the Forge `.env`.
- [ ] `php artisan config:cache` after editing.

## 2. Third-party consoles — rotate / decommission

- [ ] **Rotate the exposed Supabase `service_role` JWT** (project ref
      `jzdaqibkikflhuioptkg`) — it was in the local `.env`. Then **delete the
      Supabase project** once the DB migration is confirmed done.
- [ ] **Delete the Google + Facebook OAuth apps** (social login is removed).
- [ ] **EAS / Forge env:** remove `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`,
      `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`,
      `EXPO_PUBLIC_FACEBOOK_APP_ID` from any build/server env.

## 3. Realtime — confirm the prod Reverb chain is live

The mobile client crash is fixed (`a1b7a04`). The socket only connects if the
server side is up (these are separate Forge processes):

- [ ] `BROADCAST_CONNECTION=reverb` in the Forge `.env` (NOT `log`/`null`).
- [ ] Reverb daemon running (`php artisan reverb:start --port=8080`) + nginx
      `/app` WS proxy live on `:443`.
- [ ] Queue worker running — 5 of 6 broadcast events are *queued*; without a
      worker, chat/notifications/status won't publish (only live-location will).
- [ ] Mobile `EXPO_PUBLIC_REVERB_KEY` == server `REVERB_APP_KEY`.

## 4. On-device verification (RN runtime can't be checked from the repo)

- [ ] Reload/rebuild → **no `[echo] realtime disabled …` warning** = realtime restored.
- [ ] Booking → Details → Special Instructions: the dock editor + note chips work.
- [ ] Any multiline / numeric field: the keyboard **Done** bar appears (iOS).
- [ ] Eyeball the **12 cleaned illustrations** at real screen size.

## 5. Assets — 6 need a designer's hand-edit (~2 min each)

Automated raster removal damages these (checker sits amid same-colored artwork).
Fix in Figma/Illustrator (select the checker region, delete) or re-export clean:

| Asset | Issue |
|---|---|
| `illustrations/location-off.png` | slash line crosses the checker → gapped line |
| `illustrations/error-generic.png` | base shadow is the box's own blue → won't lift |
| `illustrations/runner-offline.png` | gray open-ring wheels = same gray as ground checker |
| `illustrations/runner-onboarding.png` | same |
| `illustrations/runner-no-jobs.png` | same |
| `food-pickup.png` | (no real checker — leave as-is) |

**Cleaned & verified (12):** session-expired, empty-addresses, purchase-and-deliver,
maintenance, auth-forgot, empty-cart, map-cluster, map-dot-user, empty-search,
runner-earnings-empty, onboarding-book, onboarding-safety.

## 6. Optional

- [ ] Slim `errandguy-mobile/assets/favicon-square.png` (~311 KB) via pngquant.

---
_Key commits: `a1b7a04` realtime · `51b56d2`/`8168979`/`f06c8cc` Supabase removal ·
`b6e6b5e` social-login removal · `fa6f65d`…`4dcefab` asset cleanup._
