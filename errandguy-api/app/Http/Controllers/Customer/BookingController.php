<?php

namespace App\Http\Controllers\Customer;

use App\Enums\PaymentStatus;
use App\Events\BookingCancelled;
use App\Events\BookingCreated;
use App\Http\Controllers\Controller;
use App\Http\Requests\Booking\CancelBookingRequest;
use App\Http\Requests\Booking\CreateBookingRequest;
use App\Http\Requests\Booking\EstimateRequest;
use App\Http\Resources\BookingResource;
use App\Jobs\AutoCancelBookingJob;
use App\Jobs\BroadcastToRunnersJob;
use App\Jobs\ExpireNegotiateBookingJob;
use App\Jobs\MatchRunnerJob;
use App\Exceptions\PaymentGatewayException;
use App\Models\Booking;
use App\Models\BookingStatusLog;
use App\Models\ErrandType;
use App\Models\Payment;
use App\Models\PaymentMethod;
use App\Models\RunnerLocation;
use App\Services\CancellationPolicy;
use App\Services\PaymentService;
use App\Services\PricingService;
use App\Services\PromoService;
use App\Services\WalletService;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class BookingController extends Controller
{
    public function __construct(
        private PricingService $pricingService,
        private PromoService $promoService,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $query = $request->user()
            ->customerBookings()
            ->with([
                'errandType',
                'runner:id,phone,full_name,avatar_url,role,status,phone_verified,avg_rating,total_ratings,created_at',
                'review',
            ])
            ->orderByDesc('created_at');

        // Status filtering supports both exact statuses AND the aggregate
        // buckets the app's Activity tabs use (active / completed /
        // cancelled). Previously only an exact match worked, so passing
        // ?status=active returned an empty list and the app was forced to
        // download everything and filter client-side (slow + wrong under
        // pagination). Filtering server-side fixes both.
        if ($request->filled('status')) {
            $status = $request->input('status');
            $completed = ['completed', 'delivered'];
            $cancelled = ['cancelled', 'no_runner', 'expired', 'rejected', 'failed'];

            match ($status) {
                'all' => null,
                'active' => $query->whereNotIn('status', array_merge($completed, $cancelled)),
                'completed' => $query->whereIn('status', $completed),
                'cancelled' => $query->whereIn('status', $cancelled),
                default => $query->where('status', $status),
            };
        }

        if ($request->filled('errand_type_id')) {
            $query->where('errand_type_id', $request->input('errand_type_id'));
        }

        if ($request->filled('date_from')) {
            $query->where('created_at', '>=', Carbon::parse($request->input('date_from'))->startOfDay());
        }

        if ($request->filled('date_to')) {
            $query->where('created_at', '<=', Carbon::parse($request->input('date_to'))->endOfDay());
        }

        $bookings = $query->paginate($request->perPage(15));

        return response()->json(
            BookingResource::collection($bookings)->response()->getData(true)
        );
    }

    public function store(CreateBookingRequest $request): JsonResponse
    {
        $validated = $request->validated();
        $user = $request->user();
        $errandType = ErrandType::findOrFail($validated['errand_type_id']);

        // Single-location errands fall back to pickup as dropoff for tracking/pricing.
        $dropoffLat = $validated['dropoff_lat'] ?? $validated['pickup_lat'];
        $dropoffLng = $validated['dropoff_lng'] ?? $validated['pickup_lng'];
        $dropoffAddress = $validated['dropoff_address'] ?? $validated['pickup_address'];

        // Calculate pricing
        $vehicleType = $validated['vehicle_type_rate'] ?? 'motorcycle';
        $pricing = $this->pricingService->calculate(
            $validated['errand_type_id'],
            $validated['pickup_lat'],
            $validated['pickup_lng'],
            $dropoffLat,
            $dropoffLng,
            $vehicleType,
            $validated['schedule_type']
        );

        // Handle promo code
        $promoDiscount = 0;
        $promoCodeId = null;
        if (!empty($validated['promo_code'])) {
            try {
                $promo = $this->promoService->validate(
                    $validated['promo_code'],
                    $user->id,
                    $pricing['total_amount']
                );
                $promoDiscount = $promo['discount'];
                $promoCodeId = $promo['id'];
            } catch (\InvalidArgumentException $e) {
                return response()->json(['message' => $e->getMessage()], 422);
            }
        }

        // Determine if transportation
        $isTransportation = $errandType->slug === 'transportation';

        // Generate booking number: EG-YYYYMMDD-XXXX
        $bookingNumber = 'EG-' . now()->format('Ymd') . '-' . strtoupper(Str::random(4));

        // Generate ride PIN for transportation
        $ridePin = $isTransportation ? str_pad((string) random_int(0, 9999), 4, '0', STR_PAD_LEFT) : null;

        $booking = Booking::create([
            'booking_number' => $bookingNumber,
            'customer_id' => $user->id,
            'errand_type_id' => $validated['errand_type_id'],
            'status' => 'pending',
            'pickup_address' => $validated['pickup_address'],
            'pickup_lat' => $validated['pickup_lat'],
            'pickup_lng' => $validated['pickup_lng'],
            'pickup_contact_name' => $validated['pickup_contact_name'] ?? null,
            'pickup_contact_phone' => $validated['pickup_contact_phone'] ?? null,
            'dropoff_address' => $dropoffAddress,
            'dropoff_lat' => $dropoffLat,
            'dropoff_lng' => $dropoffLng,
            'dropoff_contact_name' => $validated['dropoff_contact_name'] ?? null,
            'dropoff_contact_phone' => $validated['dropoff_contact_phone'] ?? null,
            'description' => $validated['description'] ?? null,
            'special_instructions' => $validated['special_instructions'] ?? null,
            'estimated_item_value' => $validated['estimated_item_value'] ?? null,
            'shopping_budget' => $validated['shopping_budget'] ?? null,
            // Persist a shopping checklist supplied at create time. Items arrive
            // as {name, qty}; normalize to the stored shape (server-assigned id,
            // untickable at creation) so the runner can tick them later.
            'shopping_items' => isset($validated['shopping_items'])
                ? array_map(fn ($it) => [
                    'id' => (string) \Illuminate\Support\Str::uuid(),
                    'name' => $it['name'],
                    'qty' => $it['qty'] ?? 1,
                    'checked' => false,
                    'checked_at' => null,
                ], $validated['shopping_items'])
                : null,
            'schedule_type' => $validated['schedule_type'],
            'scheduled_at' => $validated['scheduled_at'] ?? null,
            'pricing_mode' => $validated['pricing_mode'],
            'vehicle_type_rate' => $vehicleType,
            'distance_km' => $pricing['distance_km'],
            'base_fee' => $pricing['base_fee'],
            'distance_fee' => $pricing['distance_fee'],
            'service_fee' => $pricing['service_fee'],
            'surcharge' => $pricing['surcharge'],
            'promo_discount' => $promoDiscount,
            'total_amount' => $pricing['total_amount'] - $promoDiscount,
            'customer_offer' => $validated['customer_offer'] ?? null,
            'runner_payout' => $pricing['runner_payout'],
            'promo_code_id' => $promoCodeId,
            'ride_pin' => $ridePin,
            'is_transportation' => $isTransportation,
        ]);

        // Handle item photos upload
        if ($request->hasFile('item_photos')) {
            $photos = [];
            foreach ($request->file('item_photos') as $photo) {
                $path = $photo->store('booking-photos/' . $booking->id, 'public');
                $photos[] = \Illuminate\Support\Facades\Storage::disk('public')->url($path);
            }
            $booking->update(['item_photos' => $photos]);
        }

        // Create initial status log
        BookingStatusLog::create([
            'booking_id' => $booking->id,
            'status' => 'pending',
            'changed_by' => $user->id,
            'note' => 'Booking created',
        ]);

        // Redeem promo if used
        if ($promoCodeId) {
            $this->promoService->redeem($promoCodeId, $booking->id);
        }

        // ── Payment ──────────────────────────────────────────────────────
        // Capture the chosen settlement method and collect payment.
        //  - wallet : deduct now (fail the booking if the balance is short)
        //  - cash   : leave unpaid; the runner collects on completion
        //  - online : create a Xendit hosted invoice and return its URL; the
        //             booking is marked paid by the invoice.paid webhook
        $paymentMethod = $validated['payment_method'];
        $amount = (float) $booking->total_amount;
        $checkoutUrl = null;
        // Surfaced in the response so the app can poll GET /payments/{id}/status
        // to verify settlement without assuming success from the redirect.
        $paymentId = null;
        $booking->update(['payment_method' => $paymentMethod]);

        // A previously-linked reusable method (e.g. Maya/GrabPay) chosen for a
        // one-tap charge — usually needs no redirect.
        $savedMethod = ! empty($validated['payment_method_id'])
            ? PaymentMethod::where('id', $validated['payment_method_id'])
                ->where('user_id', $user->id)
                ->where('status', 'active')
                ->whereNotNull('gateway_ref')
                ->first()
            : null;

        if ($savedMethod) {
            $payment = Payment::create([
                'booking_id' => $booking->id,
                'customer_id' => $user->id,
                'amount' => $amount,
                'currency' => 'PHP',
                'method' => $paymentMethod,
                'status' => 'pending',
            ]);
            $paymentId = $payment->id;
            try {
                $charge = app(PaymentService::class)->chargeSavedMethod(
                    $savedMethod->gateway_ref,
                    $amount,
                    "booking-{$payment->id}",
                    "ErrandGuy booking {$booking->booking_number}",
                );
                $chargeStatus = strtoupper($charge['status'] ?? '');

                if ($chargeStatus === 'SUCCEEDED') {
                    $payment->transitionTo(PaymentStatus::Completed, extra: [
                        'gateway_tx_id' => $charge['id'] ?? null,
                        'gateway_response' => $charge,
                        'paid_at' => now(),
                    ]);
                    $booking->update(['payment_status' => 'paid']);
                } elseif (in_array($chargeStatus, ['FAILED', 'EXPIRED', 'VOIDED'], true)) {
                    throw new \RuntimeException('Charge was declined.');
                } else {
                    // PENDING / REQUIRES_ACTION — first charge may need a quick
                    // auth this time; the payment.succeeded webhook confirms it.
                    $payment->transitionTo(PaymentStatus::Processing, extra: [
                        'gateway_tx_id' => $charge['id'] ?? null,
                        'gateway_response' => $charge,
                    ]);
                    $booking->update(['payment_status' => 'pending']);
                    $checkoutUrl = PaymentService::extractActionUrl($charge);
                }
            } catch (\Throwable $e) {
                $payment->transitionTo(PaymentStatus::Failed, reason: 'Saved-method charge failed');
                $booking->delete();
                \Illuminate\Support\Facades\Log::error('Booking saved-method charge failed', [
                    'booking_number' => $booking->booking_number,
                    'error' => $e->getMessage(),
                ]);
                $message = 'Could not charge your saved payment method. Please try another.';
                if (config('app.debug') && $e instanceof PaymentGatewayException) {
                    $message = "Payment gateway error: {$e->reason()}";
                }
                return response()->json(['message' => $message], 422);
            }
        } elseif ($paymentMethod === 'wallet') {
            try {
                app(WalletService::class)->deduct(
                    $user->id,
                    $amount,
                    $booking->id,
                    "Payment for booking {$booking->booking_number}",
                );
            } catch (\RuntimeException $e) {
                // Not enough balance — undo the booking so we don't leave an
                // orphaned unpayable row, and tell the client to add funds.
                $booking->delete();
                return response()->json([
                    'message' => 'Insufficient wallet balance. Please add money or choose another payment method.',
                ], 422);
            }
            // Wallet already debited above; create the payment as pending then
            // record the settlement transition so it lands in the audit log.
            $payment = Payment::create([
                'booking_id' => $booking->id,
                'customer_id' => $user->id,
                'amount' => $amount,
                'currency' => 'PHP',
                'method' => 'wallet',
                'status' => 'pending',
            ]);
            $paymentId = $payment->id;
            $payment->transitionTo(PaymentStatus::Completed, extra: ['paid_at' => now()]);
            $booking->update(['payment_status' => 'paid']);
        } elseif ($paymentMethod === 'cash') {
            $payment = Payment::create([
                'booking_id' => $booking->id,
                'customer_id' => $user->id,
                'amount' => $amount,
                'currency' => 'PHP',
                'method' => 'cash',
                'status' => 'pending',
            ]);
            $paymentId = $payment->id;
            $booking->update(['payment_status' => 'unpaid']);
        } else {
            // Online (card / gcash / maya) via Xendit hosted invoice.
            $payment = Payment::create([
                'booking_id' => $booking->id,
                'customer_id' => $user->id,
                'amount' => $amount,
                'currency' => 'PHP',
                'method' => $paymentMethod,
                'status' => 'pending',
            ]);
            $paymentId = $payment->id;
            try {
                $invoice = app(PaymentService::class)->createInvoice(
                    $amount,
                    "booking-{$payment->id}",
                    "ErrandGuy booking {$booking->booking_number}",
                    (string) ($user->email ?? ''),
                    // Bridge page → app deep link so the in-app sheet auto-closes.
                    url('/payment/complete'),
                );
                $payment->transitionTo(PaymentStatus::Processing, extra: [
                    'gateway_tx_id' => $invoice['id'] ?? null,
                    'gateway_response' => $invoice,
                ]);
                $checkoutUrl = $invoice['invoice_url'] ?? null;
                $booking->update(['payment_status' => 'pending']);
            } catch (\Throwable $e) {
                $payment->transitionTo(PaymentStatus::Failed, reason: 'Gateway invoice creation failed');
                $booking->delete();
                \Illuminate\Support\Facades\Log::error('Booking online payment failed', [
                    'booking_number' => $booking->booking_number,
                    'error' => $e->getMessage(),
                ]);
                // Friendly line in production; the real gateway reason in debug
                // so it's diagnosable from the app itself.
                $message = 'Could not start payment. Please try again or choose another method.';
                if (config('app.debug') && $e instanceof \App\Exceptions\PaymentGatewayException) {
                    $message = "Payment gateway error: {$e->reason()}";
                }
                return response()->json(['message' => $message], 422);
            }
        }

        // Dispatch matching job based on pricing mode.
        // For SCHEDULED bookings we defer the broadcast/match until ~15
        // minutes before the scheduled time so a runner isn't sent to
        // pickup hours early.
        $isScheduled = ($validated['schedule_type'] ?? 'now') === 'scheduled'
            && !empty($validated['scheduled_at']);
        $scheduledAt = $isScheduled ? \Carbon\Carbon::parse($validated['scheduled_at']) : null;
        $matchAt = $scheduledAt
            ? $scheduledAt->copy()->subMinutes(15)
            : null;

        if ($validated['pricing_mode'] === 'fixed') {
            if ($matchAt && $matchAt->isFuture()) {
                // Scheduled bookings: defer to the queue at $matchAt.
                MatchRunnerJob::dispatch($booking->id)->delay($matchAt);
            } else {
                // Immediate bookings: run matching synchronously inside the
                // request so the customer doesn't depend on a queue worker
                // being healthy. The matching call is read-mostly and
                // typically finishes in well under a second; the booking
                // row is updated in the same DB transaction the job uses.
                MatchRunnerJob::dispatchSync($booking->id);
            }
            // Auto-cancel if no runner accepts within the system timeout.
            $autoCancelMinutes = (int) \App\Models\SystemConfig::getValue('auto_cancel_timeout_minutes', '30');
            $autoCancelAt = ($matchAt && $matchAt->isFuture() ? $matchAt : now())
                ->copy()->addMinutes($autoCancelMinutes);
            AutoCancelBookingJob::dispatch($booking->id)->delay($autoCancelAt);
        } else {
            // Negotiate mode: broadcast offer + set expiry per spec (5 minutes).
            $negotiateMinutes = (int) \App\Models\SystemConfig::getValue('negotiate_timeout_minutes', '5');
            $broadcastAt = $matchAt && $matchAt->isFuture() ? $matchAt : now();
            $booking->update([
                'negotiate_expires_at' => $broadcastAt->copy()->addMinutes($negotiateMinutes),
            ]);
            // Run the broadcast inline for immediate bookings (same reasoning
            // as fixed-mode above — don't block on a queue worker).
            if ($matchAt && $matchAt->isFuture()) {
                BroadcastToRunnersJob::dispatch($booking->id)->delay($matchAt);
            } else {
                BroadcastToRunnersJob::dispatchSync($booking->id);
            }
            ExpireNegotiateBookingJob::dispatch($booking->id)
                ->delay($broadcastAt->copy()->addMinutes($negotiateMinutes));
        }

        // Fire booking created event
        event(new BookingCreated($booking));

        $booking->load(['errandType', 'statusLogs']);

        return response()->json([
            'data' => new BookingResource($booking),
            // For online payments the client must open this hosted-checkout
            // URL to pay; null for cash/wallet (already settled/deferred).
            'checkout_url' => $checkoutUrl,
            // Lets the app poll GET /payments/{id}/status to verify settlement
            // rather than assuming success from the checkout redirect.
            'payment_id' => $paymentId,
            'message' => 'Booking created successfully.',
        ], 201);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $booking = Booking::with([
            'errandType',
            'runner:id,phone,full_name,avatar_url,role,status,phone_verified,avg_rating,total_ratings,created_at',
            'runner.runnerProfile:user_id,vehicle_type,vehicle_plate,vehicle_photo_url,verification_status,acceptance_rate,completion_rate,is_online,total_errands,approved_at',
            'statusLogs',
            'payment',
            'review',
        ])->findOrFail($id);

        $this->authorize('view', $booking);

        return response()->json([
            'data' => new BookingResource($booking),
        ]);
    }

    public function cancel(CancelBookingRequest $request, string $id): JsonResponse
    {
        $booking = Booking::findOrFail($id);

        $this->authorize('cancel', $booking);

        $policy = CancellationPolicy::preview($booking);

        if (! $policy['cancellable']) {
            return response()->json([
                'message' => $policy['reason'],
            ], 422);
        }

        // Cancel + refund atomically under a row lock. Previously these were
        // separate unguarded writes, so two concurrent cancels (double-tap /
        // retry) could both read payment_status === 'paid' and each issue a
        // wallet refund — a double credit. Locking the booking and re-checking
        // inside the transaction (plus the now-idempotent WalletService::refund)
        // makes a repeat cancel a no-op.
        DB::transaction(function () use ($booking, $request, $policy) {
            $locked = Booking::whereKey($booking->id)->lockForUpdate()->firstOrFail();

            // Already cancelled by a racing/earlier request — nothing to do.
            if ($locked->status === 'cancelled') {
                return;
            }

            $locked->update([
                'status' => 'cancelled',
                'cancelled_at' => now(),
                'cancelled_by' => $request->user()->id,
                'cancellation_reason' => $request->validated('reason'),
                'cancellation_fee' => $policy['fee'],
                // Revoke any active trip-share link so the recipient can no
                // longer poll the public endpoint for runner GPS or addresses
                // after the trip has been called off. The customer can re-share
                // a fresh link if they rebook.
                'trip_share_token' => null,
                'trip_share_active' => false,
            ]);

            // Refund money already collected, minus the cancellation fee, to the
            // customer's wallet. Applies to wallet AND online bookings that were
            // already paid; cash bookings collected nothing so there's nothing to
            // refund. The kept fee is the platform/runner compensation.
            if ($locked->payment_status === 'paid') {
                $refundable = round(max(0, (float) $locked->total_amount - (float) $policy['fee']), 2);
                if ($refundable > 0) {
                    app(WalletService::class)->refund($locked->customer_id, $refundable, $locked->id);
                    Payment::where('booking_id', $locked->id)
                        ->where('status', 'completed')
                        ->latest()
                        ->first()
                        ?->transitionTo(
                            PaymentStatus::Refunded,
                            actor: $request->user()->id,
                            reason: 'Booking cancelled: refund to wallet minus fee',
                            meta: ['cancellation_fee' => (float) $policy['fee'], 'refunded_to' => 'wallet'],
                            extra: [
                                'refund_amount' => $refundable,
                                'refunded_at' => now(),
                            ],
                        );
                }
                $locked->update(['payment_status' => 'refunded']);
            }
        });

        $booking->refresh();

        BookingStatusLog::create([
            'booking_id' => $booking->id,
            'status' => 'cancelled',
            'changed_by' => $request->user()->id,
            'note' => $request->validated('reason'),
        ]);

        event(new BookingCancelled($booking));

        $booking->load(['errandType', 'statusLogs']);

        return response()->json([
            'data' => new BookingResource($booking),
            'cancellation' => $policy,
            'message' => $policy['fee'] > 0
                ? 'Booking cancelled. A ₱'.number_format($policy['fee'], 2).' cancellation fee was applied.'
                : 'Booking cancelled successfully.',
        ]);
    }

    public function cancelPreview(Request $request, string $id): JsonResponse
    {
        $booking = Booking::findOrFail($id);
        $this->authorize('cancel', $booking);

        return response()->json([
            'data' => CancellationPolicy::preview($booking),
        ]);
    }

    public function track(Request $request, string $id): JsonResponse
    {
        $booking = Booking::with([
            'errandType',
            'runner:id,phone,full_name,avatar_url,role,status,phone_verified,avg_rating,total_ratings,created_at',
            'runner.runnerProfile:user_id,vehicle_type,vehicle_plate,vehicle_photo_url,verification_status,acceptance_rate,completion_rate,is_online,total_errands,approved_at',
            'statusLogs',
        ])->findOrFail($id);

        $this->authorize('track', $booking);

        $latestLocation = null;
        if ($booking->runner_id) {
            $latestLocation = RunnerLocation::where('booking_id', $booking->id)
                ->where('runner_id', $booking->runner_id)
                ->orderByDesc('created_at')
                ->first();
        }

        return response()->json([
            'data' => [
                'booking' => new BookingResource($booking),
                'runner_location' => $latestLocation ? [
                    'lat' => $latestLocation->lat,
                    'lng' => $latestLocation->lng,
                    'heading' => $latestLocation->heading,
                    'speed' => $latestLocation->speed,
                    'updated_at' => $latestLocation->created_at,
                ] : null,
            ],
        ]);
    }

    public function active(Request $request): JsonResponse
    {
        $booking = $request->user()
            ->customerBookings()
            ->with([
                'errandType',
                'runner:id,phone,full_name,avatar_url,role,status,phone_verified,avg_rating,total_ratings,created_at',
                'runner.runnerProfile:user_id,vehicle_type,vehicle_plate,vehicle_photo_url,verification_status,acceptance_rate,completion_rate,is_online,total_errands,approved_at',
                'statusLogs',
            ])
            ->active()
            ->orderByDesc('created_at')
            ->first();

        return response()->json([
            'data' => $booking ? new BookingResource($booking) : null,
        ]);
    }

    public function estimate(EstimateRequest $request): JsonResponse
    {
        $validated = $request->validated();

        $estimates = $this->pricingService->estimate(
            $validated['errand_type_id'],
            $validated['pickup_lat'],
            $validated['pickup_lng'],
            $validated['dropoff_lat'] ?? null,
            $validated['dropoff_lng'] ?? null
        );

        return response()->json([
            'data' => $estimates,
        ]);
    }

    public function rebook(Request $request, string $id): JsonResponse
    {
        $original = Booking::findOrFail($id);

        $this->authorize('view', $original);

        // Recalculate pricing with current rates
        $vehicleType = $original->vehicle_type_rate ?? 'motorcycle';
        $pricing = $this->pricingService->calculate(
            $original->errand_type_id,
            $original->pickup_lat,
            $original->pickup_lng,
            $original->dropoff_lat,
            $original->dropoff_lng,
            $vehicleType
        );

        $bookingNumber = 'EG-' . now()->format('Ymd') . '-' . strtoupper(Str::random(4));
        $ridePin = $original->is_transportation ? str_pad((string) random_int(0, 9999), 4, '0', STR_PAD_LEFT) : null;

        $newBooking = Booking::create([
            'booking_number' => $bookingNumber,
            'customer_id' => $request->user()->id,
            'errand_type_id' => $original->errand_type_id,
            'status' => 'pending',
            'pickup_address' => $original->pickup_address,
            'pickup_lat' => $original->pickup_lat,
            'pickup_lng' => $original->pickup_lng,
            'pickup_contact_name' => $original->pickup_contact_name,
            'pickup_contact_phone' => $original->pickup_contact_phone,
            'dropoff_address' => $original->dropoff_address,
            'dropoff_lat' => $original->dropoff_lat,
            'dropoff_lng' => $original->dropoff_lng,
            'dropoff_contact_name' => $original->dropoff_contact_name,
            'dropoff_contact_phone' => $original->dropoff_contact_phone,
            'description' => $original->description,
            'special_instructions' => $original->special_instructions,
            'estimated_item_value' => $original->estimated_item_value,
            'schedule_type' => 'now',
            'pricing_mode' => $original->pricing_mode,
            'vehicle_type_rate' => $vehicleType,
            'distance_km' => $pricing['distance_km'],
            'base_fee' => $pricing['base_fee'],
            'distance_fee' => $pricing['distance_fee'],
            'service_fee' => $pricing['service_fee'],
            'surcharge' => $pricing['surcharge'],
            'total_amount' => $pricing['total_amount'],
            'runner_payout' => $pricing['runner_payout'],
            'ride_pin' => $ridePin,
            'is_transportation' => $original->is_transportation,
        ]);

        BookingStatusLog::create([
            'booking_id' => $newBooking->id,
            'status' => 'pending',
            'changed_by' => $request->user()->id,
            'note' => 'Rebooked from ' . $original->booking_number,
        ]);

        MatchRunnerJob::dispatch($newBooking->id);
        event(new BookingCreated($newBooking));

        $newBooking->load(['errandType', 'statusLogs']);

        return response()->json([
            'data' => new BookingResource($newBooking),
            'message' => 'Booking rebooked successfully.',
        ], 201);
    }

    /**
     * Re-attempt matching for a booking that previously failed to find
     * a runner. Resets status back to `pending`, dispatches a fresh
     * MatchRunnerJob with a progressively widened radius (1.5×, 2×, 3×
     * the system default) and re-arms the auto-cancel safety net.
     */
    public function retryMatch(Request $request, string $id): JsonResponse
    {
        $booking = Booking::findOrFail($id);

        $this->authorize('retryMatch', $booking);

        $validated = $request->validate([
            // 1 = default radius, 2 = ~2x, 3 = ~3x. Capped server-side
            // so a malicious client can't request a 1000km sweep.
            'widen_step' => ['nullable', 'integer', 'min:1', 'max:3'],
        ]);
        $step = (int) ($validated['widen_step'] ?? 1);
        $multiplier = match ($step) {
            2 => 1.75,
            3 => 2.5,
            default => 1.0,
        };
        $baseRadius = (float) \App\Models\SystemConfig::getValue('matching_radius_km', '10');
        $radius = $baseRadius * $multiplier;

        $booking->update([
            'status' => 'pending',
            // Reviving an auto-cancelled booking — clear the cancellation
            // marker so subsequent reads don't display "cancelled" copy.
            'cancelled_at' => null,
            'cancellation_reason' => null,
        ]);

        BookingStatusLog::create([
            'booking_id' => $booking->id,
            'status' => 'pending',
            'changed_by' => $request->user()->id,
            'note' => sprintf('Retry match (step %d, radius %.1fkm)', $step, $radius),
        ]);

        // Run matching inline so the customer sees the result in the same
        // request (matches the immediate-booking path in store()).
        MatchRunnerJob::dispatchSync($booking->id, $radius);

        // Re-arm auto-cancel — short window so the customer isn't left
        // hanging if this widened sweep also fails.
        $autoCancelMinutes = (int) \App\Models\SystemConfig::getValue(
            'retry_auto_cancel_timeout_minutes',
            '5',
        );
        AutoCancelBookingJob::dispatch($booking->id)
            ->delay(now()->addMinutes($autoCancelMinutes));

        $booking->load(['errandType', 'statusLogs']);

        return response()->json([
            'data' => new BookingResource($booking),
            'meta' => ['radius_km' => $radius, 'widen_step' => $step],
            'message' => 'Searching again with a wider radius.',
        ]);
    }
}
