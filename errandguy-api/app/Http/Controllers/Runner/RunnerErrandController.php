<?php

namespace App\Http\Controllers\Runner;

use App\Events\BookingStatusChanged;
use App\Http\Controllers\Controller;
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
            return response()->json([
                'message' => $e->getMessage() === 'has_active'
                    ? 'You already have an active errand. Complete it first.'
                    : 'This booking is no longer available.',
            ], 422);
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

        // Notify customer
        Notification::create([
            'user_id' => $booking->customer_id,
            'title' => 'Runner Assigned!',
            'body' => "{$user->full_name} accepted your errand.",
            'type' => 'booking_update',
            'data' => json_encode(['booking_id' => $booking->id]),
        ]);

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

        // Update acceptance rate
        if ($profile) {
            $totalOffers = max(1, $profile->total_errands + 1);
            $newAcceptanceRate = max(0, ($profile->acceptance_rate * $profile->total_errands) / $totalOffers);
            $profile->update(['acceptance_rate' => round($newAcceptanceRate, 2)]);
        }

        // For fixed-price: trigger matching service to find next runner
        if ($booking->pricing_mode === 'fixed' && $booking->status === 'matched') {
            $booking->update(['status' => 'pending', 'runner_id' => null, 'matched_at' => null]);
            // Re-dispatch matching
            \App\Jobs\MatchRunnerJob::dispatch($booking->id);
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
        $bookings = Booking::with([
                'errandType',
                'customer:id,full_name,avatar_url,role,avg_rating,total_ratings,created_at',
            ])
            ->where('status', 'pending')
            ->where('pricing_mode', 'negotiate')
            ->where('negotiate_expires_at', '>', now())
            ->whereNull('runner_id')
            ->orderByDesc('created_at')
            ->get();

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

        DB::transaction(function () use ($booking, $updateData, $validated, $user, $newStatus, $oldStatus) {
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

            // Notify customer
            $statusLabel = str_replace('_', ' ', ucfirst($newStatus));
            Notification::create([
                'user_id' => $booking->customer_id,
                'title' => 'Errand Update',
                'body' => "Your errand is now: {$statusLabel}",
                'type' => 'booking_update',
                'data' => json_encode(['booking_id' => $booking->id]),
            ]);

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
        });

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

        // Notify customer
        Notification::create([
            'user_id' => $booking->customer_id,
            'title' => 'PIN Verified',
            'body' => 'Your ride PIN has been verified. Have a safe trip!',
            'type' => 'booking_update',
            'data' => json_encode(['booking_id' => $booking->id]),
        ]);

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
     * Handle booking completion: payout, stats update, payment marking.
     */
    private function handleCompletion(Booking $booking, $user): void
    {
        $profile = $user->runnerProfile;
        if (!$profile) {
            return;
        }

        $payoutAmount = (float) $booking->runner_payout;

        // Idempotency guard: if an earning transaction already exists for
        // this booking we must NOT credit again. Status updates can race
        // (double-tap, retried job, accidental re-completion via admin),
        // and without this check the runner would be paid twice and the
        // stats counters would double-count.
        $alreadyPaid = WalletTransaction::where('user_id', $user->id)
            ->where('reference_id', $booking->id)
            ->where('type', 'earning')
            ->exists();

        if ($alreadyPaid) {
            // Still mark payment completed if it slipped through, but skip
            // the wallet credit + stats bump.
            $payment = $booking->payment;
            if ($payment && $payment->status !== 'completed') {
                $payment->update([
                    'status' => 'completed',
                    'paid_at' => now(),
                ]);
            }
            return;
        }

        // Lock the runner row to serialize concurrent earnings writes.
        $user = \App\Models\User::lockForUpdate()->find($user->id);
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

        // Update runner stats
        $newTotalErrands = $profile->total_errands + 1;
        $newTotalEarnings = (float) $profile->total_earnings + $payoutAmount;

        // Recalculate completion rate
        $completedCount = $user->runnerBookings()->completed()->count();
        $totalAssigned = $user->runnerBookings()
            ->whereIn('status', ['completed', 'cancelled'])
            ->count();
        $completionRate = $totalAssigned > 0
            ? round(($completedCount / $totalAssigned) * 100, 2)
            : 100.00;

        $profile->update([
            'total_errands' => $newTotalErrands,
            'total_earnings' => $newTotalEarnings,
            'completion_rate' => $completionRate,
        ]);

        // Mark payment as completed
        $payment = $booking->payment;
        if ($payment && $payment->status !== 'completed') {
            $payment->update([
                'status' => 'completed',
                'paid_at' => now(),
            ]);
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
