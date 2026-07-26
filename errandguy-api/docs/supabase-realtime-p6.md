# P6 — Supabase Realtime auth (staged rollout runbook)

**Status: code shipped INERT. Do NOT enable in production until every step below
is completed and verified in staging.** This document is the runbook; the SQL is
a **reviewed template, not an applied migration**.

## Problem

The mobile Supabase client is created with only the anon key and never calls
`realtime.setAuth`, so every `postgres_changes` subscription (booking status,
runner location, notifications, chat) connects as the **anon** role. Delivery is
gated by each table's anon-role RLS SELECT policy, so subscriptions receive
nothing and the app silently lives on its polling fallbacks — paying for idle
websockets that deliver zero payloads.

## What the code already does (inert)

- **`SupabaseTokenService::mint()`** — mints a short-lived HS256 JWT
  (`role=authenticated`, `sub=<user id>`) signed with the project's **legacy JWT
  secret**. Returns `null` when `SUPABASE_JWT_SECRET` is unset.
- **`GET /realtime-token`** — returns `{ token, expires_in }`; `token` is `null`
  while the secret is unset.
- **mobile `refreshRealtimeAuth()`** — fetches that token and calls
  `supabase.realtime.setAuth(token)` **only when a token is present**. Wired into
  `preloadAfterAuth` (login + session-restore) and an app-foreground listener.

⇒ With `SUPABASE_JWT_SECRET` unset, `token` is always `null`, `setAuth` is never
called, and realtime behaves **exactly as it does today** (anon → polling). There
is no runtime change until you deliberately complete the steps below.

## Rollout (staging first — this is a security change)

### 1. Configure the secret (staging)
Supabase → Project Settings → API → **JWT Settings → JWT Secret** (the legacy
HS256 secret). Set it in the **staging** API env:
```
SUPABASE_JWT_SECRET=<staging project legacy jwt secret>
```
Confirm `GET /realtime-token` now returns a non-null `token` for an authed user.

### 2. Apply RLS (staging) — TEMPLATE, verify column names against the live schema first
> ⚠️ These policies scope SELECT to the row's participant on the `authenticated`
> role. **Verify the column names and participant logic against the actual
> Supabase schema before running.** An over-broad policy is a PII leak; an
> over-tight one silently breaks realtime. Enabling RLS affects **all** roles
> (the service key used by the Laravel backend bypasses RLS, so server writes are
> unaffected — but confirm nothing reads these tables client-side as anon today,
> e.g. public trip-share reads go through the Laravel backend, not the client).

```sql
-- notifications: a user sees only their own.
alter table public.notifications enable row level security;
create policy "notifications: owner reads"
  on public.notifications for select to authenticated
  using (user_id = auth.uid());

-- bookings: only the customer or the assigned runner.
alter table public.bookings enable row level security;
create policy "bookings: participant reads"
  on public.bookings for select to authenticated
  using (customer_id = auth.uid() or runner_id = auth.uid());

-- runner_locations: participants of the referenced booking.
alter table public.runner_locations enable row level security;
create policy "runner_locations: booking participant reads"
  on public.runner_locations for select to authenticated
  using (
    exists (
      select 1 from public.bookings b
      where b.id = runner_locations.booking_id
        and (b.customer_id = auth.uid() or b.runner_id = auth.uid())
    )
  );

-- messages: participants of the referenced booking.
alter table public.messages enable row level security;
create policy "messages: booking participant reads"
  on public.messages for select to authenticated
  using (
    exists (
      select 1 from public.bookings b
      where b.id = messages.booking_id
        and (b.customer_id = auth.uid() or b.runner_id = auth.uid())
    )
  );
```

### 3. Publication
Ensure these tables are in the `supabase_realtime` publication so changes are
emitted at all:
```sql
alter publication supabase_realtime add table
  public.notifications, public.bookings, public.runner_locations, public.messages;
-- (no-op / error-per-table if already present — check first with:
--  select * from pg_publication_tables where pubname = 'supabase_realtime';)
```

### 4. Verify end-to-end in staging
- A customer subscribed to their booking receives status/location updates live.
- A runner receives their notifications live.
- A user does **NOT** receive another user's notifications / bookings / messages
  (the PII check — do this explicitly with two accounts).
- Token refresh works across app foreground/resume (token TTL is 1h).

### 5. ONLY THEN — widen poll cadences (separate change)
The poll fallbacks were deliberately left untouched. Once staging confirms
realtime delivers, widen them in a follow-up (audit P15 / P28): e.g. the runner
active-errand status poll and the chat poll can back off, guarded on **observed
delivery** (not merely `status==='SUBSCRIBED'`, which lies under RLS blocks).

## Rollback
Unset `SUPABASE_JWT_SECRET` → `/realtime-token` returns null → the client stops
calling `setAuth` on the next refresh → realtime reverts to anon/polling. (In-app
`clearRealtimeAuth()` also resets the client to the anon key on logout.) The RLS
policies can be dropped with `drop policy … on …;` if needed.
