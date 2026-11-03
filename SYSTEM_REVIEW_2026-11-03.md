# ErrandGuy — full system review and fixes (2026-11-03)

> **Scope:** the whole system as it stands on `main` after the launch simplification
> and the 2026-11-03 convenience pass: the Laravel API, the Filament admin panel, the
> Expo app (customer and runner) and the public web pages.
>
> **Method:**
> 1. Five independent read-only reviewers, one per lens:
>    - staff workflows in the admin panel
>    - correctness of the last two weeks of server changes
>    - consistency, accessibility and states on every app screen
>    - performance and reliability
>    - app↔server wiring
> 2. Every High finding, and most Medium ones, was re-checked by hand against the code
>    before anything was changed.
> 3. Fixes were made in four groups with separate file ownership: admin panel (by
>    hand), server, customer app + UI kit, runner app + data layer.
> 4. Two fresh adversarial reviewers then read the whole diff, and their findings were
>    fixed before commit.
>
> **Baseline before any change:** `tsc` clean, jest 1,500/1,500, phpunit 1,393/1,393.

---

## 1. Summary

**About 95 findings; about 85 were fixed, with tests.** The rest are listed in §5 because
they need your decision, server access, or a phone.

The previous reviews were about money, security and the customer/runner journeys. This
one found different problems:

- **The admin panel was the weakest part.**
  - Every time showed in UTC, while its filters and "today" figures used Manila days.
  - Every dashboard card opened an unfiltered list. Filament reads `?filters=`; the
    cards sent `?tableFilters=`.
  - A staff cancel of an errand in progress left a runner who had paid for the items
    out of pocket, with no alert.
  - "Pay a runner" could debit a runner twice when Xendit rejected the send.
  - One finance person could send someone's payout to a different account with no
    alert.
  - Staff had to go back to a list for every action.
- **One app↔server gap blocked a core flow.** A "Buy for me" list of about 18 items or
  more could not be booked: the server capped the text at 500 characters. The payment
  line on tracking shipped yesterday never showed, because the server didn't send the
  field it reads. Chat inbox times were always blank.
- **On the app, two silent failures and two costs.**
  - Activity's "load more" could loop and stack error toasts.
  - Cancel could be confirmed before the fee was shown.
  - Live tracking made 3–6× the map-routing calls it needed.
  - Cached routes piled up in storage with no cleanup. On Android that storage is
    capped at 6 MB, and once it is full every save in the app (drafts, the offline SOS
    retry, the double-charge guard) fails silently.
- **The core money paths held up.** The server reviewer found no Critical or High issue in
  the last two weeks of server changes. Settlement, payment-before-matching, unpaid expiry,
  webhooks, payouts and the runner step machine all checked out.

---

## 2. How the system fits together (for orientation)

| Part | What it does |
|---|---|
| `errandguy-api` | Laravel 13 API under `/api/v1`. Sanctum tokens for the app; MySQL, Redis queue/cache, Reverb realtime, Xendit for GCash/Maya and payouts, Expo/FCM push. Services own the rules: `BookingService`, `BookingSettlementService` (pays the runner once), `WalletService` (every wallet movement), `MatchingService`/`MatchRunnerJob` (one runner offered at a time), `PaymentService` (Xendit). Scheduled sweeps reconcile payments, reap stranded bookings and detect stalls. |
| Admin panel | Filament v4 at `/admin`, staff guard with required two-step sign-in, five roles (super admin, admin, finance, support, ops). Staff work queues: SOS, stuck errands, runner verification, support, payouts. |
| `errandguy-mobile` | One Expo app for both roles. Customer: book (4 types), pay (cash, GCash, Maya, wallet), track live, chat, rate/tip, wallet withdraw, support. Runner: verification, go online, offers, step-by-step errand with proof, navigation, earnings, payouts. Shared data layer: `useQuery` (cache + dedupe + offline), realtime via Echo, an offline mutation queue. |
| Public pages | `/trip/{token}` (share-trip and SOS live link), `/delete-account`, `/terms`, `/privacy`, payment return bridge. |

---

## 3. What was checked and works

These were traced end to end in code, not assumed from the page existing:

- **App↔server routes:** every app API call maps to a real route, with the right method,
  path parameters and role. Response shapes, realtime events and push routing match,
  apart from the items in §4.3.
- **Money:**
  - Completion settles once under a row lock, with an idempotency guard and a unique index.
  - GCash/Maya errands reach runners only after payment.
  - Unpaid checkouts expire correctly, checking the gateway first.
  - Webhooks are token-checked and replay-guarded.
  - Payout and withdrawal Idempotency-Keys become the payout reference.
  - A payout sent to Xendit can't be failed by hand.
  - Staff adjustments have per-move and daily caps.
- **Runner step machine:** server and app step lists match for every type. The no-signature
  rule refuses a cash finish while money is due.
- **Admin role gates:** every page and action is gated, URL access included. Exports with
  personal data are limited to super admin and admin. CSV formula injection is
  neutralised.
- **Performance:**
  - Every list endpoint eager-loads exactly what its resource reads (no N+1).
  - Indexes match the hot queries.
  - Xendit, Expo, FCM and SMS calls have timeouts and never run inside a DB transaction.
  - Every scheduled sweep is bounded and non-overlapping.
- **App UI kit:**
  - Button, Input, ConfirmModal and SlideToConfirm are accessible.
  - No icon-only control is missing a label, and no small target lacks padding.
  - Unsaved-changes guards cover hardware back and swipe.
  - Money actions use latches plus idempotency keys.
- **Public trip page:** the step ladder matches the server's real step order for both flows,
  and the page shows no money, customer identity or phone numbers.

---

## 4. Findings and what was done

Each entry gives where the problem is and its priority, what happened before, why that's a
problem, what changed, and the result.

### 4.1 Admin panel (staff)

**A1 · High · Every time in the panel, CSV exports, booking timeline**
- **Before:** times showed in UTC with no zone label, while the date filters and "today"
  used Manila days.
- **Problem:** an SOS at 9:05 PM showed as 1:05 PM; filtering "Nov 3" listed rows dated
  Nov 2; finance reconciliation was 8 hours off.
- **Change:** the panel's display timezone is now Asia/Manila (`FilamentTimezone`), and
  exports and the timeline format in Manila too. Date-only filters are unaffected.
- **Result:** every time a staff member sees matches the clock on the wall.
- **Status:** Fixed.

**A2 · High · Dashboard cards and the status chart**
- **Before:** they linked with `?tableFilters=`, which Filament ignores.
- **Problem:** "Stuck errands: 3" opened every booking.
- **Change:** they use `?filters=`. A new test renders the card's URL and checks only the
  counted rows appear; it fails on the old link.
- **Status:** Fixed.

**A3 · High · Errand types**
- **Before:** staff could create types, delete types (a used one fails with a database
  error), rename slugs (the app and runner preferences depend on them), and change prices
  with no audit trail.
- **Change:** no create or delete, slug read-only, and every edit is logged old→new
  (`catalog.updated`).
- **Kept as is:** the folded types (food, grocery, document, laundry) can still be switched
  back on. That was a deliberate earlier decision, and an active folded type really is
  bookable on its own.
- **Status:** Fixed.

**A4 · High · Staff "Cancel booking" on an errand in progress** (found by two reviewers)
- **Before:** a full refund to the customer, no pay for the runner, and no alert. The dialog
  only said "runs the policy".
- **Problem:** a runner who had paid up to ₱3,000 for items was never repaid, and nobody
  knew.
- **Change:**
  - The dialog now spells out the money: the customer's refund, that the runner isn't paid,
    any item money owed, and "use Mark completed instead" when the runner has already
    reached the drop-off.
  - A `runner_owed_items` alert is raised.
- **Status:** Fixed.

**A5 · High · Payouts → "Pay a runner"**
- **Before:** it debits first, then sends. When Xendit refused, staff saw "Could not send
  payout".
- **Problem:** staff tried again, and the runner was debited twice.
- **Change:** the two steps are reported separately. A failed send says the money already
  left the wallet and where the payout is waiting, and it is audited (`sent: false`).
- **Status:** Fixed.

**A6 · Medium · "Send via Xendit"**
- **Before:** any account could be typed in, with no check against the requested one.
- **Problem:** one person could redirect any payout.
- **Change:** a different account now needs a written reason and raises an alert to money
  staff; it's also in the audit. A number typed differently (0917… vs +63917…) doesn't
  count as a change.
- **Status:** Fixed.

**A7 · Medium · Payout "Mark completed" (paid by hand)**
- **Before:** nothing recorded how it was paid.
- **Change:** a required "how it was paid, and the reference" field, stored in the audit.
- **Status:** Fixed.

**A8 · High · Detail pages (errand, runner, user)**
- **Before:** no actions on the page that alerts, search and links open.
- **Problem:** every rescue, KYC decision and suspension meant going back to the list.
- **Change:** Cancel, Re-run matching, Return to matching and Mark completed are on the
  errand page. Approve and Reject are on the runner page. Suspend and Unsuspend are on the
  user page. They are the same action objects as the list, with the same role gates.
- **Status:** Fixed. Refund is still on the Payments list only.

**A9 · Medium · Errand page**
- **Before:** no runner or customer phone, no link to either account, no link to the
  payment.
- **Change:** tap-to-call phones, links to both people, and a payment link for money roles.
  The chat tab's one-query-per-message refresh is fixed.
- **Status:** Fixed.

**A10 · Medium · Live alerts**
- **Before:** seven alert types that need action weren't clickable (runner suspended
  mid-errand, KYC resubmitted, completed-but-unpaid, charged-but-unrefunded, and others).
  Anyone could dismiss any alert for everyone.
- **Change:** all are linked. Money alerts can only be dismissed by money roles, and SOS
  alerts by SOS roles.
- **Status:** Fixed.

**A11 · Medium · Dashboard "Operations health"**
- **Before:** the no-runner rate read near 0%, because unmatched errands are auto-switched
  to "cancelled". Unpaid checkouts were counted as customer cancellations.
- **Change:** the three are counted apart.
- **Status:** Fixed.

**A12 · Medium · Status columns everywhere**
- **Before:** raw codes such as `heading_to_pickup` and `gcash`.
- **Change:** plain labels from one shared list (`StatusLabels`).
- **Status:** Fixed.

**A13 · Medium · Wallet ledger**
- **Before:** no "Staff adjustment" or "Tip paid" filter, and no way to see who moved money
  by hand.
- **Change:** both filters added, plus a "By staff" column, filter and export field.
- **Status:** Fixed.

**A14 · Low · Rejecting an already-approved runner**
- **Before:** they stayed online, and their errand in progress got no alert.
- **Change:** they're taken offline, and the same mid-errand alert as a suspension is
  raised.
- **Status:** Fixed.

**A15 · Low · Top-bar search**
- **Before:** "0917 123 4567" found nobody (phones are stored as +63…).
- **Change:** users and runners are found by the number as people say it.
- **Status:** Fixed.

**A16 · Low · Push to one person**
- **Before:** needed their internal ID.
- **Change:** search by name, email or mobile number.
- **Status:** Fixed.

**A17 · Low · Refund button**
- **Before:** shown on cash and live errands where it can't work. The default reason was a
  gateway code. It didn't mention that the runner keeps their pay.
- **Change:**
  - Hidden where the refund would be refused.
  - The reason is required.
  - The dialog says "the runner keeps ₱X — ErrandGuy pays this refund".
  - A large refund raises an alert, using the same threshold as adjustments.
- **Status:** Fixed. No daily cap on refunds; see §5.

**A18 · Low · Runner verification queue**
- **Before:** "Waiting" was counted from sign-up day.
- **Problem:** the colours and the queue order were wrong.
- **Change:** the wait is counted from the last document sent.
- **Status:** Fixed.

**A19 · Low · Runner earnings shown to non-money roles**
- **Before:** shown on errand rows and exports, against the documented role matrix.
- **Change:** money roles only.
- **Status:** Fixed.

**A20 · Low · Payouts list**
- **Before:** no export; "Pending payouts" counted rows already handed to Xendit.
- **Change:** export added (masked destinations, Xendit reference). Counts cover only
  payouts staff can act on, with "N with Xendit" shown apart.
- **Status:** Fixed.

**A21 · Low · Search gaps and the audit log**
- **Before:** you couldn't search by runner name or by Xendit id. The audit log showed
  "Booking #a1b2c3d4" and had no staff filter.
- **Change:** both searches added. Subjects read as "Errand EG-1023" or "Juan Cruz", and
  there's a "By staff" filter.
- **Status:** Fixed.

### 4.2 Server and API

**S1 · High · Booking create, "Buy for me"**
- **Before:** the description limit was 500 characters, and the app sends the item list as
  the description.
- **Problem:** about 18+ items were refused with an error the customer couldn't act on.
- **Change:** up to 10,000 characters when a shopping list is attached; 500 otherwise.
- **Status:** Fixed.

**S2 · Medium · `BookingResource`**
- **Before:** no `payment_method` for the customer.
- **Problem:** the tracking line "Pay the runner in cash" / "Paid with GCash" never showed.
- **Change:** sent to the owner and to staff and runners.
- **Status:** Fixed.

**S3 · Medium · Chat inbox**
- **Before:** `last_message.created_at` was always null.
- **Change:** parsed properly.
- **Status:** Fixed.

**S4 · Low · Refunds**
- **Before:** `refundUnfulfilled` only refused completed errands.
- **Problem:** a refund racing a retry could land on an errand that was live again.
- **Change:** only cancelled or no-runner errands are refunded.
- **Status:** Fixed.

**S5 · Low · Booking create**
- **Before:** a vehicle the errand type had withdrawn (rate set to 0 by staff) was accepted
  and priced without a distance fee.
- **Change:** refused with a clear message.
- **Status:** Fixed.

**S6 · Low · Tips**
- **Before:** a database error was returned as "insufficient balance" with the SQL text in
  the message. "Already tipped" was reported as "insufficient balance". The lock order
  differed from the gateway-tip path.
- **Change:** specific exceptions and codes; no SQL ever reaches the app; the booking is
  locked first, like every other money path.
- **Status:** Fixed.

**S7 · Low · Wallet-paid booking create**
- **Before:** any database error was reported as "insufficient balance" and the booking was
  closed.
- **Change:** only a real shortfall says so. Anything else closes the booking honestly and
  returns a retryable error. The debit was rolled back.
- **Status:** Fixed.

**S8 · Low · Customer cancel**
- **Before:** a double tap could log twice and push twice.
- **Change:** the second request answers "already cancelled" and does nothing.
- **Status:** Fixed.

**S9 · Low · Payment-before-matching**
- **Before:** a crash between "paid" and "start searching" left a paid errand that nothing
  searched for.
- **Change:** the reconcile sweep resumes a search that never ran.
- **Status:** Fixed.

**S10 · Low · Stall detector**
- **Before:** Queue/Pila errands raised "stalled" alerts while the runner was in line.
- **Change:** longer thresholds apply to single-location errands.
- **Status:** Fixed.

**S11 · Low · Customer "retry match"**
- **Before:** through the API, a customer could reset a still-running search over and over.
- **Change:** customers can't reset a running search; staff re-run is unchanged.
- **Status:** Fixed.

**S12 · Low · GCash/Maya tips**
- **Before:** they ignored the staff on/off switch for the payment method.
- **Change:** they honour it.
- **Status:** Fixed.

**S13 · Low · Completed cash errands**
- **Before:** they still showed the fare as "to collect".
- **Change:** nothing is due once the errand is completed.
- **Status:** Fixed.

**S14 · Low · Runner refusals**
- **Before:** raw messages like "Invalid status transition from 'cancelled' to 'picked_up'"
  with no code.
- **Change:** error codes and plain words, such as "This errand was cancelled by the
  customer". HTTP statuses are unchanged.
- **Status:** Fixed.

**S15 · Low · Realtime offer**
- **Before:** it lacked the deadline, instructions, stops, cash to collect and distance.
- **Problem:** every offer started with a fallback countdown and needed an extra request.
- **Change:** carried in the broadcast (no phone numbers).
- **Status:** Fixed.

**S16 · Medium · Sanctum `last_used_at`**
- **Before:** written on every request, every GPS ping included; nothing reads it.
- **Change:** off by default (`SANCTUM_TRACK_LAST_USED`).
- **Status:** Fixed.

**S17 · Low · Accept and status retries**
- **Before:** a retry after a lost response said "no longer available" or gave a 422.
- **Change:** an already-landed accept or step answers 200 with the errand, with no side
  effects; completion still pays once.
- **Status:** Fixed.

**S18 · Low · Housekeeping**
- **Before:** the reconcile sweep scanned all cancellation history every 15 minutes, and
  GPS-throttle 429s were logged as errors.
- **Change:** the sweep looks at 30 days only, and those 429s are no longer logged as
  errors.
- **Status:** Fixed.

**S19 · Low · Cancel messages**
- **Before:** they said "Booking cancelled…".
- **Change:** they say "Errand cancelled…", matching the app's wording rule.
- **Status:** Fixed.

### 4.3 App: customer side and shared UI

**M1 · High · Activity tab, notifications, archive: "load more"**
- **Before:** a failed page retried in a loop and stacked an error toast each time, and
  the list could show a skeleton forever. Notifications failed silently and looked
  finished.
- **Change:** one quiet "Couldn't load more · Try again" row; a page-1 error shows a proper
  error block.
- **Status:** Fixed.

**M2 · High · Cancel errand (tracking, waiting screen)**
- **Before:** the confirm button worked while the fee was still loading, or after the fee
  check failed.
- **Problem:** customers could cancel without seeing the fee.
- **Change:** confirm waits for the fee. If the check fails, the dialog says a fee may
  apply and offers "Check the fee again".
- **Status:** Fixed.

**M3 · Medium · Tracking error screen**
- **Before:** Retry only. A cold start from a push had no way back, and a 404 retried
  forever.
- **Change:** the real reason is shown, with "Go to Home"; 404 shows "Errand not found".
- **Status:** Fixed.

**M4 · Medium · Money receipts in toasts**
- **Before:** 4 seconds and 3 lines, so the new balance was cut off.
- **Change:** time scales with length (up to 10 seconds), and up to 5 lines.
- **Status:** Fixed.

**M5 · Medium · Wording**
- **Before:** "booking", "Cancel Errand", "Cancel booking?" and "Keep booking" all in one
  flow.
- **Change:** "errand" everywhere a customer reads it, in sentence case.
- **Status:** Fixed.

**M6 · Medium · Low-contrast text**
- **Before:** `textMuted`, about 2.4:1 contrast, used for real content, including money
  amounts.
- **Change:** switched to `textTertiary`.
- **Status:** Fixed.

**M7 · Medium · Large-font chrome**
- **Before:** header titles, badges and tab labels clipped at large Android font sizes, and
  titles weren't announced as headings.
- **Change:** capped scaling, `min-h` badges, the darker red danger badge, and
  `accessibilityRole="header"`.
- **Status:** Fixed.

**M8 · Low · Error screens**
- **Before:** they said "Please try again." whatever the cause.
- **Change:** the real error is passed through (offline vs server).
- **Status:** Fixed.

**M9 · Low · Notification delete**
- **Before:** three steps on the customer side (Delete, then confirm, plus an Undo toast).
- **Change:** one step plus Undo, like the runner side.
- **Status:** Fixed.

**M10 · Low · Accessibility**
- **Before:** the address search and label inputs had no labels.
- **Change:** labelled.
- **Status:** Fixed.

**C1 · Medium · Crash reports**
- **Before:** reports over the server's size limits were silently rejected.
- **Change:** trimmed to fit before sending.
- **Status:** Fixed.

**C2 · Medium · "Too many attempts"**
- **Before:** the server sent the wait time and the app dropped it, saying "Wait a moment"
  when the real wait could be up to an hour.
- **Change:** "Try again in N minutes".
- **Status:** Fixed.

**C3 · Medium · Profile photo upload**
- **Before:** uploaded at full camera size, against the server's 2 MB limit.
- **Change:** shrunk first, like every other upload.
- **Status:** Fixed.

**C4 · Medium · Booking review step**
- **Before:** server field errors showed as one toast with no way back to the field.
- **Change:** they name the step and offer "Edit" or "Change time".
- **Status:** Fixed.

**C5 · Low · Dead code**
- **Before:** unused service calls, including one to a retired endpoint.
- **Change:** removed.
- **Status:** Fixed.

### 4.4 App: runner side and data layer

**P1 · High · Live tracking and navigation routes**
- **Before:** up to 3 identical routing calls at once; a cache key that almost never hit; the
  errand screen kept fetching under navigation.
- **Problem:** about 300–500 HERE calls per errand, which costs money, battery and data.
- **Change:** one request per leg is shared; the cache key matches the refetch rule; one
  route serves both the line and the ETA; the screen pauses while covered; navigate never
  overlaps requests.
- **Status:** Fixed.

**P2 · High · App storage**
- **Before:** expired cache entries were only removed when re-read, so route entries
  piled up forever, against Android's 6 MB cap.
- **Problem:** once full, every save in the app fails silently.
- **Change:** routes are kept in memory only, and expired entries are pruned at launch.
- **Status:** Fixed.

**P3 · Medium · Runner GPS sender**
- **Before:** on iOS there was no time limit, so pings went out about every second; 4 in 5
  were refused, and late pings made the pin jump back.
- **Change:**
  - At most one send every 5.5 seconds, with no overlapping sends; the newest fix waits
    for the next slot.
  - Accuracy is sent with each fix.
  - Each ping times out after 8 seconds.
- **Status:** Fixed.

**C6 · Medium · Staff "Return to matching"**
- **Before:** the runner's screen ignored it, leaving them a live job whose buttons all
  failed.
- **Change:** the errand closes with "This errand was reassigned by support."
- **Status:** Fixed.

**M11 · Medium · Runner error screens**
- **Before:** "no longer accessible" was shown for any failure, including offline.
- **Change:** that text only for 403/404, otherwise the real reason; navigate gets
  "Go to Home". The raw `…` that showed as literal text is fixed.
- **Status:** Fixed.

**M12 · Low · Rounding**
- **Before:** "₱100 of ₱100 needed" while the balance was ₱99.60.
- **Change:** progress rounds down.
- **Status:** Fixed.

**C7 · Low · Error checks**
- **Before:** `err.response.status` checks that never matched, so re-rating a customer
  showed an error.
- **Change:** they check `err.status`.
- **Status:** Fixed.

**M13 · Low · Payout form**
- **Before:** a toast was shown on top of the field errors.
- **Change:** the field errors alone.
- **Status:** Fixed.

**M14 · Low · Runner screens: contrast, dates, wording, small targets**
- **Before:** low-contrast text, device-locale dates, "Log out" vs "Sign out", Title Case
  buttons, a 20pt-tall row, and a vehicle form seeded from an empty profile.
- **Change:** all fixed; the motorcycle has its own icon.
- **Status:** Fixed.

**P4 · Low · Realtime and memory**
- **Before:** Echo callbacks piled up on shared channels; chat polled every 8 seconds even
  with live realtime; whole-store subscriptions re-rendered heavy screens.
- **Change:** callbacks are unbound; chat polls every 30 seconds while live; one selector
  per field.
- **Status:** Fixed.

**M15 · Low · Runner notifications "load more"**
- **Before:** same silent failure as M1.
- **Change:** same fix.
- **Status:** Fixed.

### 4.5 Public web pages

**W1 · Low · `/delete-account`**
- **Before:** it copies the shared public layout instead of using it, so it has no footer
  links.
- **Status:** Not changed (cosmetic).

The others were checked and are fine. The trip page's ladder and privacy are correct, and
emails and PDF receipts have no leftovers of removed features.

---

## 5. Not changed: needs your decision, server access or a phone

| # | Priority | What | Why it's not done here |
|---|---|---|---|
| D1 | Medium | **Split the queue.** Offers, chat and status broadcasts share one queue with slow push calls, so an offer can wait behind push retries. The fix: a `realtime` queue, and the Forge worker run as `--queue=realtime,default` with 2+ processes. | Changing the code without changing the Forge worker would stop realtime delivery entirely. It needs both changes together, by someone with Forge access. |
| D2 | Low | **Daily cap on staff refunds.** Refunds now alert at the threshold but have no daily cap. | A policy choice: a cap could block legitimate mass refunds after an outage. |
| D3 | Low | **Booking-create lock after a crash.** A request killed mid-create leaves its idempotency lock for 24h, so that one draft gets "still processing". | A safe takeover needs the created booking id stored on the lock. If done wrong, it double-books. |
| D4 | Low | **Runner earnings tab.** It downloads up to 100 full bookings, and a month with more than 100 errands drops its oldest days. | Needs a new per-day totals endpoint plus an app change. |
| D5 | Low | **Customer tracking re-renders** the whole 3,600-line screen on every runner location tick. | A large refactor of a live-map screen, which needs a device to verify. |
| D6 | Low | **Matching takes the 50 nearest runners before filtering by errand type**, so a dense area could miss a farther runner who wants the type. | Doesn't apply at launch density. The JSON filter differs between MySQL and SQLite. |
| D7 | Low | **Redundant indexes** on hot tables. | A production migration on large tables; small gain. |
| D8 | Low | **Hard-coded server values in the app:** the 15-minute pay window, the ₱1,000 cash-debt pause and "about 90 seconds" in help text. | They drift only if staff change those settings. |
| D9 | Low | **The app's vehicle options** don't come from the estimate's `vehicle_types`. | The server now refuses a withdrawn vehicle (S5), so it's only cosmetic until staff zero a rate. |
| D10 | Low | **Legacy referral bonus:** a cancellation fee paid from bonus credit becomes withdrawable runner cash. | Bounded by legacy bonus balances only. |
| D11 | Low | **Refund from the payment page.** It's on the Payments list only. | Low value; the errand page links to the payment. |
| D12 | — | **NativeWind check.** About ten Pressables are styled only by a function `style` (map chips, search rows). By the documented gotcha their layout or background may be dropped. They predate the redesign reset and may render fine. | Needs a look on a phone before anyone changes them. |
| D13 | — | **Owner go-live items** from earlier reviews, still open: `TRUSTED_PROXIES`, mail, S3 backups, Semaphore key, ops alert contacts, Sentry DSN, uptime monitor, lawyer text for /terms and /privacy, GitHub credential rotation. | Operational, outside the code. |

---

## 6. Quality assurance

**Verified here:**

| Check | Before | After |
|---|---|---|
| `tsc --noEmit` | clean | **clean** |
| jest, full suite | 1,500 / 1,500 | **1,576 / 1,576** (169 suites) |
| phpunit, full suite, SQLite | 1,393 / 1,393 | **1,460 / 1,460** |
| phpunit, full suite, local MySQL 9.7 (throwaway database, dropped afterwards) | — | **1,459 passed, 1 skipped** (the skip is the backup command's SQLite-only guard test, as expected) |
| New tests | — | One for every behaviour change above. Several were also run against the old code to show they fail without the fix: the dashboard deep link, chat time, cancel race, committed wallet charge, and GPS background drop. |
| Adversarial review of the full diff | — | Two reviewers, no Critical or High findings; every finding fixed (§7) |

**Can't be tested here; needs a phone:**

- **Runner GPS cadence** on iOS while driving: one ping about every 5.5s, no 429s, and the
  pin lands where the runner stops.
- **Errand screen under navigation:** no route calls while it's covered, and the map
  catches up on return.
- **Staff "Return to matching"**, tried three ways: with the runner on the errand screen,
  with navigate on top, and with only Home open. Expect one toast, and the runner lands on
  their tabs.
- **Cancel dialog:** confirm is greyed out while the fee loads, and the "Check the fee
  again" link works.
- **Toasts:** how a 5-line toast looks, and that long receipts are readable.
- **Large Android font:** tab labels, header titles and badges.
- **Screen readers:** headers announced as headings; the one-step notification delete with
  Undo.
- **Avatar upload** of a real camera photo.
- **"Couldn't load more · Try again"** footers while offline.
- **Chat:** polling relaxes to 30s with a live socket.
- **Vehicle screen:** spinner on a cold open.

**Admin panel** changes are covered by Livewire/HTTP tests that render the real pages and
call the real actions, as each role. A browser check on desktop and a phone is still worth
doing for the new header buttons and the payout dialogs.

---

## 7. Adversarial review of the changes

Two fresh reviewers read the whole diff: one for the server and admin panel, one for the
app.

**What they confirmed.** Neither found a Critical or High problem. Nothing they traced
pays, charges or refunds twice. They confirmed these specifically:

- the new lock order on tips;
- the guard on refunds;
- the retry answers on accept and on status changes (completion still pays once);
- the role gates on the moved admin actions;
- the reassignment detection.

**What they found, all fixed before commit:**

| Found | Fix |
|---|---|
| Card refunds would have sent staff's free-text reason to Xendit, which only accepts its own reason codes. | Xendit gets `REQUESTED_BY_CUSTOMER`. The staff's words stay in the audit log. |
| A 100-item shopping list could push the runner's realtime offer past Reverb's 10 KB message limit, so the offer would never arrive. | The broadcast carries a 500-character preview; the card shows 3 lines anyway. The long-description allowance applies only to shopping errands. |
| "Pay a runner" skipped the different-account check. "Send via Xendit" alerted before the send, even if Xendit refused it. | One shared check covers both actions. The alert is raised after the attempt and says whether it went through. |
| The search-resume sweep could restart a search that was still running, when staff lengthen the search steps. | The wait now covers the whole search ladder plus two minutes. |
| A dropped connection after the wallet charge had committed would fail a paid errand and invite a second charge on the app's retry. | The code checks whether the charge landed. If it did, the errand goes ahead as paid. Tested by throwing after commit. |
| A retried cancel, after a lost response, answered 403 for a cancel that worked. | The same customer gets the same "already cancelled" answer. |
| The runner-owed alert could be lost if the refund step threw. | The alert is raised before the refund. |
| The verification card loaded every application in full to find one date. | Done in SQL. |
| CSV times changed to Manila time with no label. | Time columns say "(Manila time)". |
| The cancel dialog's fee check could hold the confirm button for about 60 seconds on a bad network (default timeout plus retries). | One 8-second attempt, then the "a fee may apply" path. |
| **Data loss.** Undo on a deleted notification stopped working 2 seconds before its toast disappeared. On the runner side, leaving the screen dropped the pending delete, so the notification came back. | The delete waits for the toast's full time on screen. Leaving the screen sends a pending delete instead of dropping it. |
| GPS: a fix held while the app was in the background (opening Waze) was sent late on return as "just now", pulling the pin back. A throttled final fix was dropped. | Held fixes are cleared when the app is backgrounded and dropped if older than 10 seconds. A throttled last fix is resent at the next slot. |
| The shared route cache merged two pickup pins up to ~150 m apart. | The coarse key is used only for a moving runner. Fixed pins keep the precise key. |
| Turn-by-turn could run one more route request after closing or after the errand ended. | Guarded. |

Each fix has a test. The ones for the committed-charge case and the GPS background case
were also run against the old code, to show they fail without the fix.

---

## 8. Release order

1. **Deploy the server first** (Forge "Deploy Now"; there are no migrations in this change).
   The app's new behaviour leans on server fields: `payment_method`, `retry_after`, chat
   times, the realtime offer fields.
2. **Then publish the app** with `eas update` (OTA). Everything here is JavaScript-only; no
   store build is needed.
3. **Optional:** set `SANCTUM_TRACK_LAST_USED=false` explicitly in the Forge env. It already
   defaults to off.
