<?php

namespace App\Http\Controllers\Runner;

use App\Events\BookingStatusChanged;
use App\Http\Controllers\Controller;
use App\Support\ErrorCode;
use App\Http\Requests\Runner\UpdateErrandStatusRequest;
use App\Http\Resources\BookingResource;
use App\Models\Booking;
use App\Models\BookingStatusLog;
use App\Models\Notification;
use App\Models\WalletTransaction;
use App\Services\LocationService;
use App\Services\MatchingService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

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
     * Transportation rides skip the "delivered" handover stage — the
     * passenger has already arrived when the ride is completed.
     */
    private const TRANSPORT_STATUS_ORDER = [
        'accepted',
        'heading_to_pickup',
        'arrived_at_pickup',
        'picked_up',
        'in_transit',
        'arrived_at_dropoff',
        'completed',
    ];

    /**
     * Single-location errands (queue, bills payment, on-site documents)
     * complete at the pickup location — there is no transit / dropoff /
     * delivered stage. Runner: accepted → heading → arrived → picked_up
     * (action done) → completed.
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
     */
    private const SINGLE_LOCATION_SLUGS = ['queue', 'bills_payment'];

    public function __construct(
        private MatchingService $matchingService,
        private LocationService $locationService,
    ) {}

    public function current(Request $request): JsonResponse
    {
        $booking = $request->user()
            ->runnerBookings()
            ->with([
                'errandType',
                'customer:id,phone,full_name,avatar_url,role,status,phone_verified,avg_rating,total_ratings,created_at',
                'statusLogs',
            ])
            ->whereNotIn('status', ['completed', 'cancelled'])
            ->orderByDesc('created_at')
            ->first();

        return response()->json([
            'data' => $booking ? new BookingResource($booking) : null,
        ]);
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
            ])
            ->where('bookings.id', $id)
            ->first();

        if (! $booking) {
            return response()->json([
                'message' => 'Errand not found',
            ], 404);
        }

        return response()->json([
            'data' => new BookingResource($booking),
        ]);
    }

    public function accept(Request $request, string $id): JsonResponse
    {
        $user = $request->user();
        $profile = $user->runnerProfile;

        if (!$profile || !$profile->is_online || $profile->verification_status !== 'approved') {
            return response()->json([
                'message' => 'You must be online and approved to accept errands.',
            ], 422);
        }

        // Atomically claim the booking to prevent two runners from accepting
        // the same offer (lockForUpdate serialises competing acceptors).
        $oldStatus = 'pending';
        try {
            $booking = DB::transaction(function () use ($id, $user, &$oldStatus) {
                $booking = Booking::whereKey($id)->lockForUpdate()->firstOrFail();

                if (!in_array($booking->status, ['pending', 'matched'])) {
                    throw new \RuntimeException('unavailable');
                }
                if ($booking->runner_id && $booking->runner_id !== $user->id) {
                    throw new \RuntimeException('unavailable');
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
                // correct transition (e.g. matched → accepted vs pending → accepted).
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
            if ($e->getMessage() === 'has_active') {
                return $this->fail(
                    ErrorCode::BOOKING_CONFLICT,
                    'You already have an active errand. Finish it before accepting another.',
                );
            }

            // Another runner accepted it, or it was cancelled, between the offer
            // and this tap — a stale view, not the runner's fault.
            return $this->fail(
                ErrorCode::BOOKING_STALE,
                'This errand is no longer available — someone may have already accepted it. Pull to refresh for new ones.',
            );
        }

        BookingStatusLog::create([
            'booking_id' => $booking->id,
            'status' => 'accepted',
            'changed_by' => $user->id,
            'note' => "Accepted by runner {$user->full_name}",
        ]);

        // Bust the per-runner active-booking cache so the very next GPS
        // tick attaches `booking_id` to the new ride instead of returning
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
        $profile = $user->runnerProfile;

        // A booking that has already been matched/assigned to a runner may only
        // be declined by THAT runner. Otherwise any runner could POST decline on
        // someone else's matched booking and reset it to 'pending' (a griefing /
        // dispatch-tampering hole). Negotiate broadcasts have runner_id = null,
        // so a nearby runner declining an offer still works.
        if ($booking->runner_id !== null && $booking->runner_id !== $user->id) {
            return $this->fail(ErrorCode::ERRAND_NOT_ASSIGNED, 'You are not assigned to this errand.', 403);
        }

        // Update acceptance rate
        if ($profile) {
            $totalOffers = max(1, $profile->total_errands + 1);
            $newAcceptanceRate = max(0, ($profile->acceptance_rate * $profile->total_errands) / $totalOffers);
            $profile->update(['acceptance_rate' => round($newAcceptanceRate, 2)]);
        }

        // For fixed-price: trigger matching service to find next runner
        if ($booking->pricing_mode === 'fixed' && $booking->status === 'matched') {
            $booking->update(['status' => 'pending', 'runner_id' => null, 'matched_at' => null]);

            // Surface the matched → pending revert to the customer live, so
            // their tracking screen drops back to "finding a runner" instead of
            // showing a runner who just walked away. The old WAL-tail feed used to
            // deliver this automatically; now it's an explicit Reverb broadcast. The
            // `pending` status has no push template (SendBookingStatusNotification)
            // and the referral listener no-ops off `completed`, so this fires the
            // broadcast only — no spurious notification.
            event(new BookingStatusChanged($booking, 'matched', 'pending'));

            // Re-dispatch matching, EXCLUDING the runner who just declined —
            // otherwise findRunner (now that runner_id is null and they're still
            // online/nearest) instantly re-offers the same errand to them,
            // defeating the decline. Mirrors ExpireStaleMatchesJob.
            \App\Jobs\MatchRunnerJob::dispatch($booking->id, null, $user->id);
        }

        return response()->json([
            'message' => 'Errand declined.',
        ]);
    }

    public function available(Request $request): JsonResponse
    {
        $user = $request->user();
        $profile = $user->runnerProfile;

        if (!$profile || !$profile->is_online) {
            return response()->json(['data' => []]);
        }

        // Negotiate-mode bookings still open. Only the minimal customer
        // fields are eager-loaded; the runner has not been matched yet
        // and must not be able to harvest the customer's phone / email
        // by browsing — and tapping decline on — every broadcast.
        $maxRadiusKm = $profile->working_area_radius
            ? (float) $profile->working_area_radius / 1000
            : 10.0;

        $query = Booking::with([
                'errandType',
                'customer:id,full_name,avatar_url,role,avg_rating,total_ratings,created_at',
            ])
            ->where('status', 'pending')
            ->where('pricing_mode', 'negotiate')
            ->where('negotiate_expires_at', '>', now())
            ->whereNull('runner_id');

        // Bounding-box prefilter (same 25%-margin box as MatchingService) so we
        // don't load every open negotiate booking in the country and haversine
        // them in PHP. The precise circle filter still runs below.
        if ($profile->current_lat && $profile->current_lng) {
            $lat = (float) $profile->current_lat;
            $lng = (float) $profile->current_lng;
            $latDelta = ($maxRadiusKm * 1.25) / 111.0;
            $cos = max(0.000001, cos(deg2rad($lat)));
            $lngDelta = ($maxRadiusKm * 1.25) / (111.0 * $cos);
            $query->whereBetween('pickup_lat', [$lat - $latDelta, $lat + $latDelta])
                  ->whereBetween('pickup_lng', [$lng - $lngDelta, $lng + $lngDelta]);
        }

        // Hard cap the result set — an unbounded ->get() here was a
        // latency / memory risk as open-booking volume grows.
        $bookings = $query->orderByDesc('created_at')->limit(100)->get();

        // Filter by runner's location and preferred types
        $preferredTypes = $profile->preferred_types ?? [];
        $filtered = $bookings->filter(function (Booking $booking) use ($profile, $preferredTypes) {
            // Filter by preferred types — preferred_types stores errand-type
            // slugs (e.g. "delivery"), not UUIDs. Compare against the eager-
            // loaded errandType->slug, otherwise every booking is filtered
            // out and the runner sees an empty list.
            if (!empty($preferredTypes)) {
                $slug = $booking->errandType?->slug;
                if (!$slug || !in_array($slug, $preferredTypes, true)) {
                    return false;
                }
            }

            // Filter by distance (within working area or 10km default)
            if ($profile->current_lat && $profile->current_lng && $booking->pickup_lat && $booking->pickup_lng) {
                $distance = $this->haversineDistance(
                    (float) $profile->current_lat,
                    (float) $profile->current_lng,
                    (float) $booking->pickup_lat,
                    (float) $booking->pickup_lng
                );
                $maxRadius = $profile->working_area_radius
                    ? (float) $profile->working_area_radius / 1000
                    : 10.0;

                return $distance <= $maxRadius;
            }

            return true;
        })->values();

        return response()->json([
            'data' => BookingResource::collection($filtered),
        ]);
    }

    public function updateStatus(UpdateErrandStatusRequest $request, string $id): JsonResponse
    {
        $booking = Booking::with('errandType')->findOrFail($id);
        $user = $request->user();

        if ($user->id !== $booking->runner_id) {
            return response()->json([
                'message' => 'You are not assigned to this errand.',
            ], 403);
        }

        $validated = $request->validated();
        $newStatus = $validated['status'];
        $oldStatus = $booking->status;

        // Validate status transition order (per errand type)
        if (!$this->isValidTransition($oldStatus, $newStatus, $booking)) {
            return response()->json([
                'message' => "Invalid status transition from '{$oldStatus}' to '{$newStatus}' for this errand type.",
            ], 422);
        }

        $updateData = ['status' => $newStatus];

        // Handle photo uploads per status
        if ($newStatus === 'picked_up' && $request->hasFile('pickup_photo')) {
            $path = $request->file('pickup_photo')->store(
                "booking-photos/{$booking->id}",
                'public'
            );
            $updateData['pickup_photo_url'] = Storage::disk('public')->url($path);
            $updateData['picked_up_at'] = now();
        }

        // Receipt + actual cost reconciliation for shopping errands
        // (food / grocery / purchase / bills_payment).
        if ($newStatus === 'picked_up' && $request->hasFile('receipt_photo')) {
            $path = $request->file('receipt_photo')->store(
                "booking-photos/{$booking->id}",
                'public'
            );
            $updateData['receipt_photo_url'] = Storage::disk('public')->url($path);
        }
        if ($newStatus === 'picked_up' && $request->filled('actual_item_cost')) {
            $updateData['actual_item_cost'] = $validated['actual_item_cost'];
        }
        // Defensive: if shopping_budget is set, hard-cap actual_item_cost server-side.
        if (isset($updateData['actual_item_cost']) && $booking->shopping_budget !== null
            && (float) $updateData['actual_item_cost'] > (float) $booking->shopping_budget) {
            return response()->json([
                'message' => 'Reported amount exceeds the customer’s pre-authorized budget.',
            ], 422);
        }
        // Mark picked_up_at even when there is no pickup_photo (e.g. transportation, queue, bills).
        if ($newStatus === 'picked_up' && !isset($updateData['picked_up_at'])) {
            $updateData['picked_up_at'] = now();
        }

        if ($newStatus === 'delivered' && $request->hasFile('delivery_photo')) {
            $path = $request->file('delivery_photo')->store(
                "booking-photos/{$booking->id}",
                'public'
            );
            $updateData['delivery_photo_url'] = Storage::disk('public')->url($path);
        }

        if ($newStatus === 'completed' && $request->hasFile('signature')) {
            $path = $request->file('signature')->store(
                "booking-photos/{$booking->id}",
                'public'
            );
            $updateData['signature_url'] = Storage::disk('public')->url($path);
        }
        // Always stamp completed_at on completion — single-location and transportation
        // errands finish without a signature, so the timestamp must not depend on the upload.
        if ($newStatus === 'completed') {
            $updateData['completed_at'] = now();
        }

        $conflict = DB::transaction(function () use ($booking, $updateData, $validated, $user, $newStatus, $oldStatus) {
            // Serialize concurrent status changes on this booking. Re-read the
            // row under a lock and bail if another request already advanced it.
            // Without this the earlier (unlocked) transition check is a
            // check-then-act race: two overlapping "completed" calls (double-tap
            // or a retried request) would both pass and credit the runner twice.
            $locked = Booking::whereKey($booking->id)->lockForUpdate()->first();
            if (! $locked || $locked->status !== $oldStatus) {
                return true; // already moved on — treat as an idempotent no-op
            }

            $booking->update($updateData);

            // Create status log
            BookingStatusLog::create([
                'booking_id' => $booking->id,
                'status' => $newStatus,
                'changed_by' => $user->id,
                'note' => $validated['note'] ?? null,
                'lat' => $validated['lat'] ?? null,
                'lng' => $validated['lng'] ?? null,
            ]);

            // The customer status notification (in-app row + push) is created
            // solely by the BookingStatusChanged listener dispatched below —
            // a direct Notification::create here duplicated that row (unread +2)
            // for every status the listener also templates.

            // Handle completion
            if ($newStatus === 'completed') {
                $this->handleCompletion($booking, $user);
            }

            // The runner's "active booking" cache (used by
            // RunnerLocationController to tag GPS pushes) needs to be
            // dropped on any terminal transition, otherwise the next
            // 30s of location pings would still be attributed to a
            // booking that's already done.
            if (in_array($newStatus, ['completed', 'cancelled', 'no_runner'], true)) {
                Cache::forget("runner_active_booking_id:{$user->id}");
            }

            event(new BookingStatusChanged($booking, $oldStatus, $newStatus));

            return false;
        });

        if ($conflict) {
            return response()->json([
                'message' => 'This errand was just updated. Pull to refresh.',
            ], 409);
        }

        $booking->load(['errandType', 'customer', 'statusLogs']);

        return response()->json([
            'data' => new BookingResource($booking),
            'message' => 'Status updated.',
        ]);
    }

    public function verifyPin(Request $request, string $id): JsonResponse
    {
        $request->validate([
            'pin' => ['required', 'digits:4'],
        ]);

        $booking = Booking::findOrFail($id);
        $user = $request->user();

        if ($user->id !== $booking->runner_id) {
            return response()->json([
                'message' => 'You are not assigned to this errand.',
            ], 403);
        }

        if (!$booking->is_transportation) {
            return response()->json([
                'message' => 'PIN verification is only for transportation errands.',
            ], 422);
        }

        if ($booking->ride_pin_verified) {
            return response()->json([
                'message' => 'PIN already verified.',
            ]);
        }

        // Check PIN attempts (max 3)
        $attemptKey = "pin_attempts:{$booking->id}";
        $attempts = (int) cache($attemptKey, 0);

        if ($attempts >= 3) {
            return response()->json([
                'message' => 'Maximum PIN attempts exceeded. Please contact support.',
            ], 422);
        }

        if ($request->input('pin') !== $booking->ride_pin) {
            cache([$attemptKey => $attempts + 1], now()->addMinutes(30));

            return response()->json([
                'message' => 'Incorrect PIN. ' . (2 - $attempts) . ' attempts remaining.',
            ], 422);
        }

        $booking->update(['ride_pin_verified' => true]);

        BookingStatusLog::create([
            'booking_id' => $booking->id,
            'status' => $booking->status,
            'changed_by' => $user->id,
            'note' => 'Ride PIN verified',
        ]);

        // Notify the customer live. notifyInApp persists the row AND broadcasts
        // it on notifications.{userId}; a raw Notification::create would write
        // the row but never reach the app live (the customer is mid-trip and
        // waiting on this confirmation).
        app(\App\Services\NotificationService::class)->notifyInApp(
            $booking->customer_id,
            'PIN Verified',
            'Your ride PIN has been verified. Have a safe trip!',
            ['type' => 'booking_update', 'booking_id' => $booking->id],
        );

        return response()->json([
            'message' => 'PIN verified successfully.',
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
        if ($booking->is_transportation) {
            return self::TRANSPORT_STATUS_ORDER;
        }

        $slug = $booking->errandType?->slug;
        if ($slug && in_array($slug, self::SINGLE_LOCATION_SLUGS, true)) {
            return self::SINGLE_LOCATION_STATUS_ORDER;
        }

        return self::STATUS_ORDER;
    }

    /**
     * Handle booking completion: settlement, stats update, payment marking.
     *
     * Settlement is a function of what was ACTUALLY collected — never of the
     * booking status alone (that was the critical money leak):
     *   - paid (wallet/online): the platform holds the funds, so the runner's
     *     payout is credited to their withdrawable wallet.
     *   - cash: the runner collected the full fare in person, so they keep it
     *     and OWE the platform its service fee — recorded as a negative
     *     'commission' entry that nets against their wallet balance (and thus
     *     against future earnings / payout). Their balance may go negative;
     *     that debt is the point.
     *   - unsettled online (expired/failed): nobody collected → credit nothing.
     */
    private function handleCompletion(Booking $booking, $user): void
    {
        $profile = $user->runnerProfile;
        if (!$profile) {
            return;
        }

        // Idempotency guard: if this booking is already settled for this runner
        // (an 'earning' credit OR a cash 'commission' debit) we must NOT settle
        // again. Runs inside the booking-locked transaction from updateStatus,
        // so it is race-safe; the uq_wallet_tx_user_reference_type index is the
        // DB-level backstop.
        $alreadySettled = WalletTransaction::where('user_id', $user->id)
            ->where('reference_id', $booking->id)
            ->whereIn('type', ['earning', 'commission'])
            ->exists();

        if ($alreadySettled) {
            $this->markPaymentCompleted($booking->payment, $user->id);
            return;
        }

        // Lock the runner row to serialize concurrent balance writes.
        $user = \App\Models\User::lockForUpdate()->find($user->id);
        $payoutAmount = (float) $booking->runner_payout;
        $earnedForStats = 0.0;
        $collected = false;

        if ($booking->payment_status === 'paid') {
            $newBalance = (float) $user->wallet_balance + $payoutAmount;
            WalletTransaction::create([
                'user_id' => $user->id,
                'type' => 'earning',
                'amount' => $payoutAmount,
                'balance_after' => $newBalance,
                'reference_id' => $booking->id,
                'description' => "Earning for errand #{$booking->booking_number}",
            ]);
            $user->update(['wallet_balance' => $newBalance]);
            $earnedForStats = $payoutAmount;
            $collected = true;
        } elseif ($booking->payment_method === 'cash') {
            // Runner nets their payout in cash; platform is owed the service fee.
            $commission = round((float) $booking->service_fee, 2);
            $newBalance = (float) $user->wallet_balance - $commission;
            WalletTransaction::create([
                'user_id' => $user->id,
                'type' => 'commission',
                'amount' => -$commission,
                'balance_after' => $newBalance,
                'reference_id' => $booking->id,
                'description' => "Platform commission for cash errand #{$booking->booking_number}",
            ]);
            $user->update(['wallet_balance' => $newBalance]);
            $earnedForStats = $payoutAmount; // earned in cash, in person
            $collected = true;
        }
        // else: unsettled online payment — nothing was collected, credit nothing.

        // Update runner stats
        $newTotalErrands = $profile->total_errands + 1;
        $newTotalEarnings = (float) $profile->total_earnings + $earnedForStats;

        // Recalculate completion rate with a SINGLE conditional-aggregation
        // query — was two separate COUNT(*) round-trips held under the booking
        // + runner row locks, needlessly lengthening lock hold time. Because
        // 'completed' is a strict subset of the {completed,cancelled} assigned
        // set, SUM(CASE ...) equals the old completed()->count() and COUNT(*)
        // equals the old total, so the computed rate is identical.
        // NOTE: 'completed' is hardcoded here rather than reusing the
        // Booking::completed() scope; if that scope ever grows beyond a bare
        // status filter, keep this in sync (guarded by the completion_rate
        // regression test in StatusUpdateTest).
        $stats = $user->runnerBookings()
            ->whereIn('status', ['completed', 'cancelled'])
            ->toBase()
            ->selectRaw("COUNT(*) as total_assigned, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_count")
            ->first();
        $totalAssigned = (int) ($stats->total_assigned ?? 0);
        $completedCount = (int) ($stats->completed_count ?? 0);
        $completionRate = $totalAssigned > 0
            ? round(($completedCount / $totalAssigned) * 100, 2)
            : 100.00;

        $profile->update([
            'total_errands' => $newTotalErrands,
            'total_earnings' => $newTotalEarnings,
            'completion_rate' => $completionRate,
        ]);

        // Only record the payment as settled when money was actually collected
        // (platform-side for paid, in-person cash for cash). An unsettled online
        // charge must NOT be laundered to 'completed'.
        if ($collected) {
            $this->markPaymentCompleted($booking->payment, $user->id);
        }
    }

    /**
     * Move the booking's payment to Completed through the audited
     * {@see \App\Models\Payment::transitionTo()} funnel — never a raw
     * ->update(['status' => ...]), which would skip the payment_status_transitions
     * audit row and could launder an illegal failed/expired -> completed move
     * with a fabricated paid_at. No-ops safely when the payment is null, already
     * completed, or cannot legally advance.
     */
    private function markPaymentCompleted(?\App\Models\Payment $payment, string $actorId): void
    {
        if (! $payment) {
            return;
        }

        $current = \App\Enums\PaymentStatus::tryFrom((string) $payment->status);
        if ($current && $current->canTransitionTo(\App\Enums\PaymentStatus::Completed)) {
            $payment->transitionTo(
                \App\Enums\PaymentStatus::Completed,
                actor: $actorId,
                reason: 'Errand completed',
                extra: ['paid_at' => now()],
            );
        }
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
