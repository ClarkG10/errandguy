<?php

namespace App\Http\Controllers\Runner;

use App\Enums\BookingStatus;
use App\Events\BookingStatusChanged;
use App\Http\Controllers\Controller;
use App\Support\ErrorCode;
use App\Http\Requests\Runner\UpdateErrandStatusRequest;
use App\Http\Resources\BookingResource;
use App\Models\Booking;
use App\Models\BookingStatusLog;
use App\Services\BookingSettlementService;
use App\Support\VehicleClass;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class RunnerErrandController extends Controller
{
    private const STATUS_ORDER = [
        'accepted',
        'heading_to_pickup',
        'arrived_at_pickup',
        'picked_up',
        'in_transit',
        'arrived_at_dropoff',
        'delivered',
        'completed',
    ];

    /**
     * Single-location errands (queue) complete at the pickup location — there
     * is no transit / dropoff / delivered stage. Runner: accepted → heading →
     * arrived → picked_up (action done) → completed.
     */
    private const SINGLE_LOCATION_STATUS_ORDER = [
        'accepted',
        'heading_to_pickup',
        'arrived_at_pickup',
        'picked_up',
        'completed',
    ];

    /**
     * Errand type slugs that finish at a single location.
     * Must stay in sync with mobile errandTypeRules.ts singleLocation flag.
     *
     * bills_payment is a LEGACY alias: the type is retired (inactive, so it
     * can't be booked), but an errand booked before the retirement still ends
     * at the payment counter. Every other retired slug needs no entry here —
     * document/laundry/food/grocery and old passenger rides all follow the
     * standard STATUS_ORDER.
     *
     * Public so DetectStalledErrandsCommand reads the same list.
     */
    public const SINGLE_LOCATION_SLUGS = ['queue', 'bills_payment'];

    /**
     * Terminal statuses after which a booking's per-stop ticks are frozen —
     * same set ShoppingChecklistController uses for its checklist.
     */
    private const CLOSED_STATUSES = BookingStatus::FINALIZED;

    public function current(Request $request): JsonResponse
    {
        $booking = $request->user()
            ->runnerBookings()
            ->with([
                'errandType',
                'customer:id,phone,full_name,avatar_url,role,status,phone_verified,avg_rating,total_ratings,created_at',
                'statusLogs',
                'stops',
            ])
            ->whereNotIn('status', ['completed', 'cancelled'])
            ->orderByDesc('created_at')
            ->first();

        if ($booking) {
            $this->attachPickupDistance($booking, $request->user());
        }

        return response()->json([
            'data' => $booking ? new BookingResource($booking) : null,
        ]);
    }

    /**
     * Stamp `distance_to_pickup_km` on a matched OFFER so the runner's offer
     * modal can show how far the pickup is on its very first frame — before any
     * live GPS fix exists (the app's client-side line renders nothing until
     * then). Only for `matched`: once the errand is accepted the app has a live
     * fix and its own number is the authoritative one, and skipping the lookup
     * keeps the 30s active-errand poll at its current query count.
     *
     * Measured from the runner profile's last ping, so it can be a few minutes
     * stale — treat it as approximate in the UI.
     */
    private function attachPickupDistance(Booking $booking, $user): void
    {
        if ($booking->status !== 'matched' || ! $booking->pickup_lat || ! $booking->pickup_lng) {
            return;
        }

        $profile = $user->runnerProfile;
        if (! $profile || ! $profile->current_lat || ! $profile->current_lng) {
            return;
        }

        $booking->setAttribute('distance_to_pickup_km', round($this->haversineDistance(
            (float) $profile->current_lat,
            (float) $profile->current_lng,
            (float) $booking->pickup_lat,
            (float) $booking->pickup_lng,
        ), 1));
    }

    /**
     * Show a single errand assigned to this runner. Used by deep links
     * (e.g. notification → errand detail) when the booking is not the
     * runner's currently active errand — historic / completed errands
     * are still viewable via the same screen.
     *
     * Scoped via the `runnerBookings` relation so a runner can only ever
     * fetch bookings where they were the assigned runner. 404 if not.
     */
    public function show(Request $request, string $id): JsonResponse
    {
        $booking = $request->user()
            ->runnerBookings()
            ->with([
                'errandType',
                'customer:id,phone,full_name,avatar_url,role,status,phone_verified,avg_rating,total_ratings,created_at',
                'statusLogs',
                'stops',
            ])
            ->where('bookings.id', $id)
            ->first();

        if (! $booking) {
            return $this->fail(ErrorCode::NOT_FOUND, 'Errand not found.', 404);
        }

        // Deep links from the offer push land here, so the same approximate
        // pickup distance current() shows must be available on this payload too.
        $this->attachPickupDistance($booking, $request->user());

        return response()->json([
            'data' => new BookingResource($booking),
        ]);
    }

    public function accept(Request $request, string $id): JsonResponse
    {
        $user = $request->user();
        $profile = $user->runnerProfile;

        // Two refusals with their own codes (the status stays 422): "not
        // approved" has app copy of its own, and an approved runner who is
        // merely offline must not be told their account isn't approved.
        if (! $profile || $profile->verification_status !== 'approved') {
            return $this->fail(
                ErrorCode::RUNNER_NOT_APPROVED,
                'Your runner account must be approved before you can accept errands.',
                422,
            );
        }
        if (! $profile->is_online) {
            return $this->fail(ErrorCode::ACCEPT_NOT_ALLOWED, 'Go online to accept errands.', 422);
        }

        // Atomically claim the booking to prevent a lapsed offer from being
        // accepted after it moved on (lockForUpdate serialises it against the
        // stale-offer sweep, a decline, or a cancel).
        $oldStatus = 'matched';
        $alreadyAccepted = false;
        try {
            $booking = DB::transaction(function () use ($id, $user, $profile, &$oldStatus, &$alreadyAccepted) {
                $booking = Booking::whereKey($id)->lockForUpdate()->firstOrFail();

                // Self-deal guard: a user who is BOTH a customer and an approved
                // runner (roles are freely toggleable via the profile) must never
                // accept the errand they themselves booked. Without this, one
                // account can pay as the customer and collect the runner payout,
                // self-review to inflate its rating, and farm completion stats.
                // This mirrors the excludeCustomerId contract the AUTOMATED
                // dispatch already enforces (MatchingService::findRunner).
                // (ids are UUIDs → compare as strings.)
                if ((string) $booking->customer_id === (string) $user->id) {
                    throw new \RuntimeException('self_deal');
                }

                // A retry of this runner's own accept that already landed (the
                // response was lost on a weak signal): it worked, so say so.
                // It used to read as "no longer available" — the runner was
                // told they'd lost an errand they were holding.
                if ($booking->status === 'accepted' && (string) $booking->runner_id === (string) $user->id) {
                    $alreadyAccepted = true;

                    return $booking;
                }

                // Only the runner this errand is offered to may accept it, and
                // only while the offer stands. There is no open list of errands
                // to pick from — matching offers each errand to one runner at a
                // time — so a pending booking (offer lapsed, or never offered to
                // this runner) is no longer available.
                if ($booking->status !== 'matched' || (string) $booking->runner_id !== (string) $user->id) {
                    throw new \RuntimeException('unavailable');
                }

                // The customer paid for this vehicle. Matching only offers it to
                // runners who can serve it, but a runner may have changed their
                // vehicle since the offer went out.
                if (! VehicleClass::canServe($profile->vehicle_type, $booking->vehicle_type_rate)) {
                    throw new \RuntimeException('vehicle');
                }

                // Serialize concurrent accepts by THIS runner on their User row
                // BEFORE the one-active-errand check below. Two accepts on two
                // different bookings each lock only their own booking row (no
                // mutual contention), so without this both would pass the
                // non-locking hasActive exists() — each blind to the other's
                // still-uncommitted 'accepted' write — and the runner would end
                // up holding two active errands. The booking locks above are
                // locking reads (they bypass the REPEATABLE READ snapshot), so
                // the exists() below is the transaction's first consistent read;
                // taking the User lock first makes the loser block until the
                // winner commits, then read its committed 'accepted' booking.
                // Lock order is Booking→User, matching MatchRunnerJob and
                // completion settlement, so no new deadlock cycle is introduced.
                $lockedRunner = \App\Models\User::whereKey($user->id)->lockForUpdate()->first();

                // Cash-debt ceiling. A cash errand settles by DEBITING the
                // runner's wallet for the platform's commission, so taking cash
                // work while already deep in debt digs the hole deeper with real
                // money the platform never collects. Checked here, under the
                // runner's row lock, because this is the authoritative gate —
                // MatchingService also filters indebted runners out of cash
                // dispatch, but a runner whose debt grew after the offer went
                // out must not slip past. Only CASH is blocked: prepaid/wallet
                // errands CREDIT the runner, so their way back above the line is
                // open.
                if (
                    $lockedRunner
                    && $booking->payment_method === 'cash'
                    && \App\Support\CashDebtPolicy::blocks((float) $lockedRunner->wallet_balance)
                ) {
                    throw new \RuntimeException('cash_debt');
                }

                // Only OTHER active errands should block acceptance — the
                // booking being accepted may already be assigned to this
                // runner in `matched` status (via MatchRunnerJob), in which
                // case it would otherwise self-block the acceptance.
                $hasActive = $user->runnerBookings()
                    ->where('bookings.id', '!=', $booking->id)
                    ->whereNotIn('status', ['completed', 'cancelled', 'pending'])
                    ->exists();
                if ($hasActive) {
                    throw new \RuntimeException('has_active');
                }

                // Capture the real old status for the BookingStatusChanged
                // event so listeners (notifications, analytics) report the
                // correct transition.
                $oldStatus = $booking->status;

                $booking->update([
                    'runner_id' => $user->id,
                    'status' => 'accepted',
                    'matched_at' => $booking->matched_at ?? now(),
                    'accepted_at' => now(),
                ]);

                return $booking;
            });
        } catch (\RuntimeException $e) {
            // Refusals about THIS runner and THIS errand get their own code, so
            // the app shows the server's reason instead of its generic "errand
            // in progress" copy for BOOKING_CONFLICT.
            if ($e->getMessage() === 'self_deal') {
                return $this->fail(
                    ErrorCode::ACCEPT_NOT_ALLOWED,
                    "You can't accept your own errand.",
                );
            }

            if ($e->getMessage() === 'has_active') {
                return $this->fail(
                    ErrorCode::BOOKING_CONFLICT,
                    'You already have an active errand. Finish it before accepting another.',
                );
            }

            if ($e->getMessage() === 'vehicle') {
                return $this->fail(
                    ErrorCode::ACCEPT_NOT_ALLOWED,
                    'This errand needs '.VehicleClass::requirement(Booking::whereKey($id)->value('vehicle_type_rate'))
                        .'. If your vehicle has changed, update it in Settings.',
                );
            }

            if ($e->getMessage() === 'cash_debt') {
                // Names the amount and how it clears — a bare refusal would
                // leave the runner blocked with no idea what to do about it.
                // Still a 409 (the errand can't be taken), with its own code so
                // the app doesn't show its generic "errand in progress" copy.
                return $this->fail(
                    ErrorCode::CASH_DEBT_OUTSTANDING,
                    \App\Support\CashDebtPolicy::message((float) $user->fresh()->wallet_balance),
                    409,
                );
            }

            // The offer lapsed, was taken back, or the errand was cancelled
            // between the offer and this tap — a stale view, not the runner's
            // fault.
            return $this->fail(
                ErrorCode::BOOKING_STALE,
                'This errand is no longer available — the offer may have timed out or been cancelled.',
            );
        }

        // Nothing to log, bust or announce a second time.
        if ($alreadyAccepted) {
            $booking->load([
                'errandType',
                'customer:id,phone,full_name,avatar_url,role,status,phone_verified,avg_rating,total_ratings,created_at',
                'statusLogs',
            ]);

            return response()->json([
                'data' => new BookingResource($booking),
                'message' => 'Errand accepted.',
            ]);
        }

        BookingStatusLog::create([
            'booking_id' => $booking->id,
            'status' => 'accepted',
            'changed_by' => $user->id,
            'note' => "Accepted by runner {$user->full_name}",
        ]);

        // Bust the per-runner active-booking cache so the very next GPS
        // tick attaches `booking_id` to the new errand instead of returning
        // the stale (likely null) value held by RunnerLocationController.
        Cache::forget("runner_active_booking_id:{$user->id}");

        // The customer notification (in-app row + push) is created solely by
        // the BookingStatusChanged listener (SendBookingStatusNotification's
        // 'accepted' template) — the single source of truth, exactly like
        // matched/created/cancelled. A direct Notification::create here wrote a
        // duplicate in-app row (unread +2) the moment the queued listener ran.
        event(new BookingStatusChanged($booking, $oldStatus, 'accepted'));

        $booking->load([
            'errandType',
            'customer:id,phone,full_name,avatar_url,role,status,phone_verified,avg_rating,total_ratings,created_at',
            'statusLogs',
        ]);

        return response()->json([
            'data' => new BookingResource($booking),
            'message' => 'Errand accepted.',
        ]);
    }

    public function decline(Request $request, string $id): JsonResponse
    {
        $booking = Booking::findOrFail($id);
        $user = $request->user();

        // A booking that has already been matched/assigned to a runner may only
        // be declined by THAT runner. Otherwise any runner could POST decline on
        // someone else's matched booking and reset it to 'pending' (a griefing /
        // dispatch-tampering hole).
        if ($booking->runner_id !== null && $booking->runner_id !== $user->id) {
            return $this->fail(ErrorCode::ERRAND_NOT_ASSIGNED, 'You are not assigned to this errand.', 403);
        }

        // Revert the offer to pending and re-dispatch matching.
        //
        // The precondition is re-checked UNDER A ROW LOCK, because the read at
        // the top of this method is unlocked and the write used to carry an
        // id-only WHERE. A customer tapping Cancel on the "Runner found" screen
        // at the same moment the matched runner taps Decline would commit the
        // cancel — refund issued, trip-share revoked, customer
        // told "cancelled, ₱X refunded" — and then this write would land on its
        // stale pre-cancel snapshot and RESURRECT the row as 'pending'.
        //
        // MatchRunnerJob only guards on status === 'pending', so the dead errand
        // was re-dispatched: a second runner was offered an errand the customer
        // had cancelled, and on completing it settlement found
        // payment_status === 'refunded', took neither settlement branch, and
        // credited them NOTHING. A refunded customer got a runner at their door
        // and that runner worked for free.
        //
        // Mirrors accept() above and AutoCancelBookingJob: lock, re-read, and
        // only act if the row is still what we thought it was. A decline that
        // arrives after the offer already lapsed (or was taken back) is a stale
        // tap: nothing to revert, and nothing held against the runner.
        $reverted = DB::transaction(function () use ($id, $user) {
            $locked = Booking::whereKey($id)->lockForUpdate()->first();

            if (
                ! $locked
                || $locked->status !== 'matched'
                || (string) $locked->runner_id !== (string) $user->id
            ) {
                return null;
            }

            $locked->update(['status' => 'pending', 'runner_id' => null, 'matched_at' => null]);

            return $locked;
        });

        if ($reverted) {
            $booking = $reverted;

            // Surface the matched → pending revert to the customer live, so
            // their tracking screen drops back to "finding a runner" instead of
            // showing a runner who just walked away. The old WAL-tail feed used to
            // deliver this automatically; now it's an explicit Reverb broadcast. The
            // `pending` status has no push template (SendBookingStatusNotification),
            // so this fires the broadcast only — no spurious notification.
            event(new BookingStatusChanged($booking, 'matched', 'pending'));

            // Re-dispatch matching. The declining runner is on the booking's
            // offered_runner_ids (and passed as the explicit exclusion), so
            // they are not offered this errand again this round. Mirrors
            // ExpireStaleMatchesJob.
            \App\Jobs\MatchRunnerJob::dispatch($booking->id, null, $user->id);
        }

        return response()->json([
            'message' => 'Errand declined.',
        ]);
    }

    public function updateStatus(UpdateErrandStatusRequest $request, string $id): JsonResponse
    {
        $booking = Booking::with('errandType')->findOrFail($id);
        $user = $request->user();

        if ($user->id !== $booking->runner_id) {
            return $this->fail(ErrorCode::ERRAND_NOT_ASSIGNED, 'You are not assigned to this errand.', 403);
        }

        $validated = $request->validated();
        $newStatus = $validated['status'];
        $oldStatus = $booking->status;

        // A retry of a step that already landed (the app timed out waiting
        // for the answer and sent it again): the errand is where the runner
        // asked it to be, so answer as if this request had moved it. Before
        // any upload is stored and with nothing logged, settled or announced
        // again — the first request did all of that.
        if ($oldStatus === $newStatus) {
            return $this->statusUpdated($booking);
        }

        // Validate status transition order (per errand type)
        if (!$this->isValidTransition($oldStatus, $newStatus, $booking)) {
            return $this->fail(ErrorCode::BOOKING_STATE_INVALID, $this->transitionRefusal($booking));
        }

        $updateData = ['status' => $newStatus];

        // Handle photo uploads per status
        if ($newStatus === 'picked_up' && $request->hasFile('pickup_photo')) {
            // PRIVATE media disk + participant-gated URL (was public). (audit)
            $updateData['pickup_photo_url'] = \App\Http\Controllers\BookingMediaController::storeAndUrl(
                $request->file('pickup_photo'),
                "booking-photos/{$booking->id}",
            );
            $updateData['picked_up_at'] = now();
        }

        // Receipt + actual cost reconciliation for shopping errands (purchase,
        // plus the legacy food / grocery / bills_payment aliases — see
        // UpdateErrandStatusRequest::SHOPPING_SLUGS).
        if ($newStatus === 'picked_up' && $request->hasFile('receipt_photo')) {
            // PRIVATE media disk — a receipt reveals what/where the customer
            // purchased and must not be a public URL. (audit)
            $updateData['receipt_photo_url'] = \App\Http\Controllers\BookingMediaController::storeAndUrl(
                $request->file('receipt_photo'),
                "booking-photos/{$booking->id}",
            );
        }
        if ($newStatus === 'picked_up' && $request->filled('actual_item_cost')) {
            $updateData['actual_item_cost'] = $validated['actual_item_cost'];
        }
        // Defensive: if shopping_budget is set, hard-cap actual_item_cost server-side.
        if (isset($updateData['actual_item_cost']) && $booking->shopping_budget !== null
            && (float) $updateData['actual_item_cost'] > (float) $booking->shopping_budget) {
            $message = 'Reported amount exceeds the customer’s spending limit for the items.';

            return $this->fail(ErrorCode::VALIDATION_FAILED, $message, errors: ['actual_item_cost' => [$message]]);
        }
        // Mark picked_up_at even when there is no pickup_photo (e.g. queue, shopping).
        if ($newStatus === 'picked_up' && !isset($updateData['picked_up_at'])) {
            $updateData['picked_up_at'] = now();
        }

        if ($newStatus === 'delivered' && $request->hasFile('delivery_photo')) {
            // PRIVATE media disk + participant-gated URL (was public). (audit)
            $updateData['delivery_photo_url'] = \App\Http\Controllers\BookingMediaController::storeAndUrl(
                $request->file('delivery_photo'),
                "booking-photos/{$booking->id}",
            );
        }

        if ($newStatus === 'completed' && $request->hasFile('signature')) {
            // PRIVATE media disk + participant-gated URL (was public). (audit)
            $updateData['signature_url'] = \App\Http\Controllers\BookingMediaController::storeAndUrl(
                $request->file('signature'),
                "booking-photos/{$booking->id}",
            );
        }
        // Always stamp completed_at on completion — single-location errands finish
        // without a signature, so the timestamp must not depend on the upload.
        if ($newStatus === 'completed') {
            $updateData['completed_at'] = now();
        }

        // Handed over without a signature (the request only allows that on top
        // of a delivery photo): the runner's reason becomes the completion's
        // status-log note — the record staff and the customer's status history
        // already read — instead of a bare "Completed".
        $logNote = $validated['note'] ?? null;
        if ($newStatus === 'completed' && ! $request->hasFile('signature')
            && ! empty($validated['no_signature_reason'])) {
            $reason = UpdateErrandStatusRequest::NO_SIGNATURE_REASONS[$validated['no_signature_reason']];
            $detail = trim((string) ($validated['note'] ?? ''));
            $logNote = 'No signature: '.$reason.($detail !== '' ? ' — '.$detail : '');
        }

        $conflict = DB::transaction(function () use ($booking, $updateData, $logNote, $validated, $user, $newStatus, $oldStatus) {
            // Serialize concurrent status changes on this booking. Re-read the
            // row under a lock and bail if another request already advanced it.
            // Without this the earlier (unlocked) transition check is a
            // check-then-act race: two overlapping "completed" calls (double-tap
            // or a retried request) would both pass and credit the runner twice.
            $locked = Booking::whereKey($booking->id)->lockForUpdate()->first();
            // Still this runner's errand? The assignment check at the top was
            // unlocked: staff may have taken it off them since ("Return to
            // matching") and another runner accepted it — a late tap from the
            // first runner must never advance, complete or settle the errand
            // the new runner is working.
            if ($locked && (string) $locked->runner_id !== (string) $user->id) {
                return 'not_assigned';
            }
            // A double tap: the other request just made this same step.
            if ($locked && $locked->status === $newStatus) {
                return 'already';
            }
            if (! $locked || $locked->status !== $oldStatus) {
                return 'conflict'; // already moved on — treat as an idempotent no-op
            }

            $booking->update($updateData);

            // Create status log
            BookingStatusLog::create([
                'booking_id' => $booking->id,
                'status' => $newStatus,
                'changed_by' => $user->id,
                'note' => $logNote,
                'lat' => $validated['lat'] ?? null,
                'lng' => $validated['lng'] ?? null,
            ]);

            // The customer status notification (in-app row + push) is created
            // solely by the BookingStatusChanged listener dispatched below —
            // a direct Notification::create here duplicated that row (unread +2)
            // for every status the listener also templates.

            // Handle completion
            if ($newStatus === 'completed') {
                // Re-read the row (held under the lock above) so settlement sees
                // the CURRENT payment_status/method. $booking was loaded at the
                // top of the request, and a gateway webhook may have marked the
                // charge paid DURING the pre-transaction signature/photo upload
                // window; reading that stale 'pending' here would skip both
                // settlement branches and credit the runner nothing — with no
                // recovery, because the webhook's settlePaidBooking already
                // no-op'd (the booking wasn't 'completed' yet) — MC-1. refresh()
                // re-selects the locked row inside this transaction, so it
                // reflects the committed payment_status.
                $booking->refresh();
                app(BookingSettlementService::class)->settleCompletion($booking, $user);
            }

            // The runner's "active booking" cache (used by
            // RunnerLocationController to tag GPS pushes) needs to be
            // dropped on any terminal transition, otherwise the next
            // 30s of location pings would still be attributed to a
            // booking that's already done. After the commit: a ping between
            // a forget here and the commit would re-cache the still-active
            // (uncommitted) errand for another 30s.
            if (in_array($newStatus, ['completed', 'cancelled', 'no_runner'], true)) {
                DB::afterCommit(fn () => Cache::forget("runner_active_booking_id:{$user->id}"));
            }

            return null;
        });

        if ($conflict === 'not_assigned') {
            return $this->fail(ErrorCode::ERRAND_NOT_ASSIGNED, 'You are not assigned to this errand.', 403);
        }

        if ($conflict === 'already') {
            return $this->statusUpdated($booking->fresh(['errandType']));
        }

        if ($conflict === 'conflict') {
            return $this->fail(ErrorCode::BOOKING_STALE, 'This errand was just updated. Pull to refresh.', 409);
        }

        // Dispatch AFTER the transaction commits (mirroring accept()/decline()),
        // so queued listeners see the just-completed row persisted instead of
        // racing an uncommitted write. The event itself is also
        // ShouldDispatchAfterCommit as a belt-and-suspenders guard.
        event(new BookingStatusChanged($booking, $oldStatus, $newStatus));

        return $this->statusUpdated($booking);
    }

    /** The answer to a status change: the booking as it now stands. */
    private function statusUpdated(Booking $booking): JsonResponse
    {
        $booking->load(['errandType', 'customer', 'statusLogs']);

        return response()->json([
            'data' => new BookingResource($booking),
            'message' => 'Status updated.',
        ]);
    }

    /**
     * Why a step can't be made, in words the runner can act on (it used to
     * read "Invalid status transition from 'cancelled' to 'picked_up'…").
     */
    private function transitionRefusal(Booking $booking): string
    {
        return match ($booking->status) {
            'cancelled' => $booking->cancelled_by !== null
                && (string) $booking->cancelled_by === (string) $booking->customer_id
                    ? 'This errand was cancelled by the customer.'
                    : 'This errand was cancelled.',
            'completed' => 'This errand is already completed.',
            'matched' => 'Accept this errand before updating it.',
            default => 'That step isn’t next for this errand. Refresh to see where it is.',
        };
    }

    /**
     * PATCH /runner/errand/{id}/stops/{stop} — tick an extra multi-stop
     * destination off (or un-tick a mis-tap).
     *
     * Contract: { "completed": bool } — omitted means true.
     *
     * A multi-stop booking charges the customer a real per-stop fee and the
     * extra legs flow into the runner's payout, but `booking_stops.completed_at`
     * has been an unwritten column since the table was created (its migration
     * comment reserves it for exactly this), so nothing ever recorded that a
     * stop was actually visited. This is the write side of that column. It is
     * NOT a status stage: the booking's own status machine is untouched, no
     * money moves, and completing the errand is neither gated on nor changed by
     * these ticks.
     *
     * Mirrors {@see \App\Http\Controllers\Runner\ShoppingChecklistController::update}
     * — assigned runner only, refused once the booking is closed, and the
     * customer is pushed the fresh list in-app so the ticks land live.
     *
     * IDEMPOTENT by design: the mobile side rides this on the offline mutation
     * queue, so the same tick can arrive twice. A replay that asks for the
     * state the stop is already in is a no-op — the original `completed_at`
     * survives (a re-send must not silently restamp the visit time) and no
     * second notification is emitted.
     */
    public function completeStop(Request $request, string $id, string $stopId): JsonResponse
    {
        $validated = $request->validate([
            'completed' => ['sometimes', 'boolean'],
        ]);
        $completed = (bool) ($validated['completed'] ?? true);

        $booking = Booking::findOrFail($id);
        $user = $request->user();

        if ($user->id !== $booking->runner_id) {
            return $this->fail(ErrorCode::ERRAND_NOT_ASSIGNED, 'You are not assigned to this errand.', 403);
        }

        if (in_array($booking->status, self::CLOSED_STATUSES, true)) {
            return $this->fail(
                ErrorCode::BOOKING_STATE_INVALID,
                'This errand is closed — its stops can no longer be updated.',
            );
        }

        // Scoped through the relation so a stop id from ANOTHER booking is a
        // 404 here rather than a cross-booking write.
        if (! $booking->stops()->whereKey($stopId)->exists()) {
            return $this->fail(ErrorCode::NOT_FOUND, 'That stop is not part of this errand.', 404);
        }

        // Re-read under a row lock: a double-tap (or a queue flush racing a
        // live tap) would otherwise both pass the already-in-this-state check
        // and the later write would restamp the visit time.
        $changed = DB::transaction(function () use ($booking, $stopId, $completed) {
            $stop = \App\Models\BookingStop::where('booking_id', $booking->id)
                ->whereKey($stopId)
                ->lockForUpdate()
                ->first();

            if (! $stop || $completed === ($stop->completed_at !== null)) {
                return false;
            }

            $stop->update(['completed_at' => $completed ? now() : null]);

            return true;
        });

        $booking->load(['errandType', 'runner', 'customer', 'statusLogs', 'stops']);

        // Only a real state change reaches the customer — a replayed tick from
        // the offline queue must not mint a second notification row. Same
        // fire-and-forget shape the checklist uses: notifyInApp persists the
        // row and broadcasts it on notifications.{userId} (no device wake — a
        // tick is not worth a buzz), dispatched afterResponse so it never holds
        // the runner's PATCH open. Values captured by value.
        if ($changed) {
            $customerId = $booking->customer_id;
            $bookingId = $booking->id;
            $stops = $booking->stops
                ->map(fn ($stop) => [
                    'id' => $stop->id,
                    'sequence' => $stop->sequence,
                    'completed_at' => $stop->completed_at,
                ])
                ->values()
                ->all();

            dispatch(function () use ($customerId, $bookingId, $stops) {
                // COALESCED for the same reason as the shopping checklist: this
                // fires once per completed stop, and a multi-stop errand should
                // leave ONE live card in the inbox, not one per stop.
                app(\App\Services\NotificationService::class)->notifyInAppCoalesced(
                    $customerId,
                    'Stop updated',
                    'Your runner updated a stop on your errand.',
                    [
                        'type' => 'booking_stops_updated',
                        'booking_id' => $bookingId,
                        'stops' => $stops,
                    ],
                );
            })->afterResponse();
        }

        return response()->json([
            'data' => new BookingResource($booking),
            'message' => $completed ? 'Stop marked complete.' : 'Stop reopened.',
        ]);
    }

    /**
     * Check if a status transition is valid (must follow the defined order).
     */
    private function isValidTransition(string $current, string $next, Booking $booking): bool
    {
        $order = $this->statusOrderFor($booking);
        $currentIndex = array_search($current, $order, true);
        $nextIndex = array_search($next, $order, true);

        if ($currentIndex === false || $nextIndex === false) {
            return false;
        }

        // Next status must be exactly the next step in the per-type flow
        return $nextIndex === $currentIndex + 1;
    }

    /**
     * Pick the status flow for a booking based on its errand type.
     * Falls back to the standard flow if the errand type isn't loaded.
     */
    private function statusOrderFor(Booking $booking): array
    {
        $slug = $booking->errandType?->slug;
        if ($slug && in_array($slug, self::SINGLE_LOCATION_SLUGS, true)) {
            return self::SINGLE_LOCATION_STATUS_ORDER;
        }

        return self::STATUS_ORDER;
    }

    /**
     * Calculate distance between two points using the Haversine formula.
     */
    private function haversineDistance(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $earthRadiusKm = 6371;

        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);

        $a = sin($dLat / 2) * sin($dLat / 2)
            + cos(deg2rad($lat1)) * cos(deg2rad($lat2))
            * sin($dLng / 2) * sin($dLng / 2);

        $c = 2 * atan2(sqrt($a), sqrt(1 - $a));

        return $earthRadiusKm * $c;
    }
}
