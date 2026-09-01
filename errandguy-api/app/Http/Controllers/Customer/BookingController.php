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
use App\Models\BookingStop;
use App\Models\ErrandType;
use App\Models\Payment;
use App\Models\PaymentMethod;
use App\Models\RunnerLocation;
use App\Services\BookingService;
use App\Services\CancellationPolicy;
use App\Support\ErrorCode;
use App\Services\PaymentService;
use App\Services\PricingService;
use App\Services\PromoService;
use App\Services\WalletService;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class BookingController extends Controller
{
    public function __construct(
        private PricingService $pricingService,
        private PromoService $promoService,
        private BookingService $bookingService,
    ) {}

    public function index(Request $request): JsonResponse
    {
        // Validate the filter params — date_from/date_to are fed straight into
        // Carbon::parse below, which throws (uncaught 500) on garbage input.
        $request->validate([
            'status' => ['nullable', 'string', 'max:30'],
            'errand_type_id' => ['nullable', 'uuid'],
            'date_from' => ['nullable', 'date'],
            'date_to' => ['nullable', 'date'],
        ]);

        $query = $request->user()
            ->customerBookings()
            ->with([
                'errandType',
                'runner:id,phone,full_name,avatar_url,role,status,phone_verified,avg_rating,total_ratings,created_at',
                'reviews',
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

        // Multi-stop: extra destinations after the primary dropoff. Coordinates
        // drive the fare (extra legs + per-stop fee); the full rows (address,
        // contact, note) are persisted below. Validation caps this at 3 and
        // rejects it for single-location errand types.
        $extraStops = array_map(
            fn ($s) => ['lat' => (float) $s['lat'], 'lng' => (float) $s['lng']],
            $validated['stops'] ?? [],
        );

        // Calculate pricing
        $vehicleType = $validated['vehicle_type_rate'] ?? 'motorcycle';
        $pricing = $this->pricingService->calculate(
            $validated['errand_type_id'],
            $validated['pickup_lat'],
            $validated['pickup_lng'],
            $dropoffLat,
            $dropoffLng,
            $vehicleType,
            $validated['schedule_type'],
            extraStops: $extraStops,
        );

        // Negotiate mode: the customer's offer IS the price they pay (the fixed
        // fare above becomes reference-only). The platform keeps its flat
        // computed service fee; the runner receives the offer minus that fee.
        // Applied BEFORE the promo block so a promo discounts the offer and its
        // min-spend check sees the real total. Without this, negotiate bookings
        // charged the fixed fare and customer_offer was cosmetic.
        if ($validated['pricing_mode'] === 'negotiate' && isset($validated['customer_offer'])) {
            $pricing = $this->pricingService->applyNegotiateOffer(
                $pricing,
                (float) $validated['customer_offer'],
            );
        }

        // Handle promo code
        $promoDiscount = 0;
        $promoCodeId = null;
        $perUserLimit = null;
        if (!empty($validated['promo_code'])) {
            try {
                $promo = $this->promoService->validate(
                    $validated['promo_code'],
                    $user->id,
                    $pricing['total_amount']
                );
                $promoDiscount = $promo['discount'];
                $promoCodeId = $promo['id'];
                $perUserLimit = $promo['per_user_limit'] !== null ? (int) $promo['per_user_limit'] : null;
            } catch (\InvalidArgumentException $e) {
                // PromoService throws curated, user-facing copy (invalid/expired/
                // not-eligible) — keep it, tagged with a machine code.
                return $this->fail(ErrorCode::PROMO_INVALID, $e->getMessage());
            }
        }

        // PRICE-5: a promo is a PLATFORM-funded subsidy. When the discount
        // exceeds the platform's own service fee the booking is NET-NEGATIVE —
        // the platform pays the runner more than the customer paid. That can be
        // a deliberate acquisition subsidy, but an UNBOUNDED one is a
        // money-safety risk, so every net-negative booking is logged CRITICAL
        // for ops. The correct hard ceiling is the promo's `max_discount` at
        // creation (validate() already enforces it), which caps the subsidy
        // without introducing a preview-vs-charge mismatch here.
        if ($promoDiscount > 0) {
            $platformTake = round((float) $pricing['service_fee'] - (float) $promoDiscount, 2);
            if ($platformTake < 0) {
                \Illuminate\Support\Facades\Log::critical('Net-negative booking: promo discount exceeds platform service fee', [
                    'promo_code_id' => $promoCodeId,
                    'service_fee' => (float) $pricing['service_fee'],
                    'promo_discount' => (float) $promoDiscount,
                    'platform_take' => $platformTake,
                ]);
            }
        }

        // Determine if transportation
        $isTransportation = $errandType->slug === 'transportation';

        // Booking number (EG-YYYYMMDD-XXXXXX). The generator loops on an
        // exists() check and uses a 6-char suffix (~2.2B/day space), so a
        // same-day clash is effectively impossible; a residual check-then-insert
        // race is backstopped by the unique index on booking_number.
        $bookingNumber = $this->bookingService->generateBookingNumber();

        // Generate ride PIN for transportation
        $ridePin = $isTransportation ? str_pad((string) random_int(0, 9999), 4, '0', STR_PAD_LEFT) : null;

        $bookingData = [
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
        ];

        // Race-safe per-user promo limit. validate() above checked the per-user
        // cap with a plain count (a check-then-create TOCTOU: two concurrent
        // bookings by one user could both pass and both take the discount).
        // Serialize the re-count + the insert under a per-(user,promo) lock so
        // the second waits, re-counts, and is rejected. On a race loss no booking
        // is created, so there is nothing to clean up. (audit promo TOCTOU)
        try {
            $booking = DB::transaction(function () use ($bookingData, $promoCodeId, $perUserLimit, $user) {
                if ($promoCodeId !== null && $perUserLimit !== null) {
                    $this->promoService->assertUserSlotAvailable($promoCodeId, $user->id, $perUserLimit);
                }

                return Booking::create($bookingData);
            });
        } catch (\App\Exceptions\PromoUserLimitReachedException $e) {
            return $this->fail(
                ErrorCode::PROMO_INVALID,
                'You have already used this promo code the maximum number of times.',
            );
        }

        // Persist multi-stop destinations (1-based order after the primary
        // dropoff). Priced above via extraStops; stored here with their full
        // address/contact/note so the runner has everything to complete them.
        foreach ($validated['stops'] ?? [] as $i => $stop) {
            BookingStop::create([
                'booking_id' => $booking->id,
                'sequence' => $i + 1,
                'address' => $stop['address'],
                'lat' => $stop['lat'],
                'lng' => $stop['lng'],
                'contact_name' => $stop['contact_name'] ?? null,
                'contact_phone' => $stop['contact_phone'] ?? null,
                'note' => $stop['note'] ?? null,
            ]);
        }

        // Handle item photos upload
        if ($request->hasFile('item_photos')) {
            $photos = [];
            foreach ($request->file('item_photos') as $photo) {
                // PRIVATE media disk + participant-gated URL (was public). (audit)
                $photos[] = \App\Http\Controllers\BookingMediaController::storeAndUrl(
                    $photo,
                    'booking-photos/'.$booking->id,
                );
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
        // one-tap charge — usually needs no redirect. Only honour it when the
        // DECLARED method is online: a client sending payment_method:'cash'/'wallet'
        // WITH a linked method id would otherwise get a real gateway charge while
        // the booking + payment both record 'cash' — a contradictory state the COD
        // completion path then mis-settles (debits commission on money already paid).
        $savedMethod = (! empty($validated['payment_method_id']) && ! in_array($paymentMethod, ['cash', 'wallet'], true))
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
                $this->failBooking($booking, $promoCodeId, $user->id, 'Payment failed: saved-method charge declined');
                \Illuminate\Support\Facades\Log::error('Booking saved-method charge failed', [
                    'booking_number' => $booking->booking_number,
                    'error' => $e->getMessage(),
                ]);
                $message = 'We couldn’t charge your saved payment method. You weren’t charged — try another method.';
                if (config('app.debug') && $e instanceof PaymentGatewayException) {
                    $message = "Payment gateway error: {$e->reason()}";
                }
                return $this->fail(ErrorCode::PAYMENT_GATEWAY_ERROR, $message);
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
                // Not enough balance — mark the booking failed (never hard-delete:
                // a Payment row and/or a promo redemption may already reference it,
                // which on Postgres would raise an FK error) and reverse the promo.
                $this->failBooking($booking, $promoCodeId, $user->id, 'Payment failed: insufficient wallet balance');
                $balance = number_format((float) $user->fresh()->wallet_balance, 2);

                return $this->fail(
                    ErrorCode::INSUFFICIENT_WALLET_BALANCE,
                    'This booking costs ₱'.number_format((float) $amount, 2).' but your wallet balance is ₱'.$balance
                        .'. Top up or choose another payment method — you weren’t charged.',
                );
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
        } elseif ($paymentMethod === 'gcash' || $paymentMethod === 'maya') {
            // Direct e-wallet charge via the Payment Requests API. The returned
            // action URL deep-links STRAIGHT into the GCash/Maya app to approve
            // — no Xendit hosted invoice page and no second method pick (the
            // channel is fixed here). The only remaining hop is the wallet's own
            // authorization, which no integration can remove. Settles via the
            // payment.succeeded webhook (matched on the payment_request id we
            // store as gateway_tx_id); the pull reconciler already GETs
            // /payment_requests/{id}, so this also fixes the reconcile mismatch
            // that the hosted-invoice path had for e-wallets.
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
                $pr = app(PaymentService::class)->createPaymentRequest(
                    $amount,
                    "booking-{$payment->id}",
                    $paymentMethod,
                    "ErrandGuy booking {$booking->booking_number}",
                    // Success + failure both return to the bridge page → app deep
                    // link so the in-app auth sheet auto-closes; the poll/webhook
                    // decides the real outcome. The failure URL carries
                    // ?status=failed so the bridge shows honest copy, not a green
                    // "Payment received," when the customer declines/cancels.
                    url('/payment/complete'),
                    url('/payment/complete?status=failed'),
                );

                // Persist the gateway ref FIRST (before the action-URL check) so a
                // created-but-unusable payment_request is always traceable /
                // reconcilable rather than orphaned at Xendit.
                $payment->transitionTo(PaymentStatus::Processing, extra: [
                    'gateway_tx_id' => $pr['id'] ?? null,
                    'gateway_response' => $pr,
                ]);

                $checkoutUrl = PaymentService::extractActionUrl($pr);
                if (blank($checkoutUrl)) {
                    // No authorization action to deep-link to — we can't collect
                    // the payment, so don't leave the customer on a dead spinner.
                    throw new \RuntimeException('Gateway returned no authorization action for the e-wallet charge.');
                }

                $booking->update(['payment_status' => 'pending']);
            } catch (\Throwable $e) {
                $payment->transitionTo(PaymentStatus::Failed, reason: 'E-wallet charge creation failed');
                $this->failBooking($booking, $promoCodeId, $user->id, 'Payment failed: could not start the e-wallet charge');
                \Illuminate\Support\Facades\Log::error('Booking e-wallet charge failed', [
                    'booking_number' => $booking->booking_number,
                    'error' => $e->getMessage(),
                ]);
                $message = 'We couldn’t start your GCash/Maya payment. You weren’t charged — try again or choose another method.';
                if (config('app.debug') && $e instanceof \App\Exceptions\PaymentGatewayException) {
                    $message = "Payment gateway error: {$e->reason()}";
                }
                return $this->fail(ErrorCode::PAYMENT_GATEWAY_ERROR, $message);
            }
        } else {
            // Card → Xendit hosted invoice. Cards are a small PH share and the
            // hosted page keeps card entry, 3DS, and PCI scope entirely inside
            // Xendit at zero cost; a native in-app card form is a later phase.
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
                $this->failBooking($booking, $promoCodeId, $user->id, 'Payment failed: could not create gateway invoice');
                \Illuminate\Support\Facades\Log::error('Booking online payment failed', [
                    'booking_number' => $booking->booking_number,
                    'error' => $e->getMessage(),
                ]);
                // Friendly line in production; the real gateway reason in debug
                // so it's diagnosable from the app itself.
                $message = 'We couldn’t start your payment. You weren’t charged — try again or choose another method.';
                if (config('app.debug') && $e instanceof \App\Exceptions\PaymentGatewayException) {
                    $message = "Payment gateway error: {$e->reason()}";
                }
                return $this->fail(ErrorCode::PAYMENT_GATEWAY_ERROR, $message);
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
            // Arm the auto-cancel/refund safety net FIRST. The immediate match
            // below runs synchronously and its job re-throws on a transient
            // failure (deadlock under load), which would 500 out of store() —
            // if that dispatch came first, a paid booking would be stranded
            // 'pending' with no auto-cancel armed. This job is idempotent and
            // no-ops once the booking leaves 'pending', so arming it early is
            // harmless when matching succeeds.
            $autoCancelMinutes = (int) \App\Models\SystemConfig::getValue('auto_cancel_timeout_minutes', '30');
            $autoCancelAt = ($matchAt && $matchAt->isFuture() ? $matchAt : now())
                ->copy()->addMinutes($autoCancelMinutes);
            AutoCancelBookingJob::dispatch($booking->id)->delay($autoCancelAt);

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
        } else {
            // Negotiate mode: broadcast offer + set expiry per spec (5 minutes).
            $negotiateMinutes = (int) \App\Models\SystemConfig::getValue('negotiate_timeout_minutes', '5');
            $broadcastAt = $matchAt && $matchAt->isFuture() ? $matchAt : now();
            $booking->update([
                'negotiate_expires_at' => $broadcastAt->copy()->addMinutes($negotiateMinutes),
            ]);
            // Queue the broadcast even for immediate bookings. Unlike fixed mode,
            // the 201 does NOT depend on the broadcast result (the booking is
            // already pending with negotiate_expires_at set above; runners
            // respond later), so there's no reason to run the realtime
            // fan-out inside the customer's request. Scheduled negotiate bookings
            // already depend on the queue worker, so this is consistent. (P4)
            if ($matchAt && $matchAt->isFuture()) {
                BroadcastToRunnersJob::dispatch($booking->id)->delay($matchAt);
            } else {
                BroadcastToRunnersJob::dispatch($booking->id);
            }
            ExpireNegotiateBookingJob::dispatch($booking->id)
                ->delay($broadcastAt->copy()->addMinutes($negotiateMinutes));
        }

        // Fire booking created event
        event(new BookingCreated($booking));

        // Reload columns too, not just relations: for an immediate booking the
        // synchronous MatchRunnerJob above already mutated status/runner_id on its
        // OWN model instance, so this in-memory $booking is stale. Without the
        // refresh the 201 reports status='pending'/runner_id=null while the
        // included statusLogs already show 'matched'/'no_runner' — a
        // self-contradictory response. (mirrors retryMatch.)
        $booking->refresh()->load(['errandType', 'statusLogs', 'stops']);

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

    /**
     * Terminate a booking whose payment collection failed at creation, without
     * hard-deleting it (payment review P0-2).
     *
     * The old path called $booking->delete() on a payment failure, but a
     * Payment row (and, before this, an already-incremented promo redemption)
     * references the booking by then. On Postgres the NO ACTION foreign key
     * raises 23503 → an uncaught 500 and orphaned rows; SQLite (FKs off) masked
     * it in tests. Marking the booking terminally failed is crash-safe and a
     * truthful record, and reversing the promo stops a failed attempt from
     * burning a promo use (P0-7). These bookings never reach matching (the
     * caller returns 422 first), so a 'cancelled' row with no runner is inert.
     */
    private function failBooking(Booking $booking, ?string $promoCodeId, string $actorId, string $reason): void
    {
        // Reverse the promo redemption (consumption-verified + idempotent; a
        // no-op if this booking never consumed a slot).
        if ($promoCodeId) {
            $this->promoService->unredeem($booking->id);
        }

        $booking->update([
            'status' => 'cancelled',
            'payment_status' => 'failed',
            'cancelled_at' => now(),
            'cancelled_by' => $actorId,
            'cancellation_reason' => $reason,
        ]);

        // Audit parity with every other terminal path.
        BookingStatusLog::create([
            'booking_id' => $booking->id,
            'status' => 'cancelled',
            'changed_by' => $actorId,
            'note' => $reason,
        ]);
    }

    /**
     * Attach item photos to a booking. The create request is JSON (no file
     * parts), so the customer's staged item photos are uploaded here right
     * after the booking is created. Owner-only, and only before the runner has
     * picked up — item photos exist to guide the shopping / pickup.
     */
    public function uploadItemPhotos(Request $request, string $id): JsonResponse
    {
        $booking = Booking::findOrFail($id);

        if ($booking->customer_id !== $request->user()->id) {
            abort(403);
        }

        if (! in_array($booking->status, [
            'pending', 'matched', 'accepted', 'heading_to_pickup', 'arrived_at_pickup',
        ], true)) {
            return response()->json([
                'message' => 'Item photos can only be added before the runner picks up.',
            ], 422);
        }

        $request->validate([
            'item_photos' => ['required', 'array', 'max:5'],
            // Raster-only (no SVG) — mirrors the create rule; an SVG is a
            // stored-XSS vector when an admin opens the proof in the panel.
            'item_photos.*' => ['image', 'mimes:jpeg,jpg,png,webp', 'max:5120'],
        ]);

        $photos = $booking->item_photos ?? [];
        foreach ($request->file('item_photos') as $photo) {
            $photos[] = \App\Http\Controllers\BookingMediaController::storeAndUrl(
                $photo,
                'booking-photos/'.$booking->id,
            );
        }
        // Cap the total at 5 to mirror the create-time limit.
        $booking->update(['item_photos' => array_slice($photos, 0, 5)]);

        return response()->json(['data' => new BookingResource($booking->fresh())]);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $booking = Booking::with([
            'errandType',
            'runner:id,phone,full_name,avatar_url,role,status,phone_verified,avg_rating,total_ratings,created_at',
            'runner.runnerProfile:user_id,vehicle_type,vehicle_plate,vehicle_photo_url,verification_status,acceptance_rate,completion_rate,is_online,total_errands,approved_at',
            'statusLogs',
            'stops',
            'payment',
            'reviews',
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
        $outcome = DB::transaction(function () use ($booking, $request) {
            $locked = Booking::whereKey($booking->id)->lockForUpdate()->firstOrFail();

            // Already cancelled by a racing/earlier request — nothing to do.
            if ($locked->status === 'cancelled') {
                return null;
            }

            // Authoritative re-evaluation against the LOCKED row. The booking may
            // have advanced (e.g. heading_to_pickup → arrived_at_pickup) between
            // the unlocked preview above and this lock, which changes BOTH whether
            // it is still cancellable AND the fee tier. Trusting the stale pre-lock
            // policy let a customer cancel a booking that had moved past the
            // cancellable window and be refunded at the lower flat tier instead of
            // the percentage tier the committed status requires — a money leak.
            $fresh = CancellationPolicy::preview($locked);
            if (! $fresh['cancellable']) {
                return ['error' => $fresh['reason']];
            }

            // PRICE-3 / PRICE-4: the cancellation fee we RECORD is what we can
            // actually keep, not the abstract policy number. It is
            //   - capped at the fare the customer paid (a flat ₱20 fee can never
            //     swallow more than a ₱15 errand, so preview and settlement agree
            //     and a cheap errand can't lose its whole fare), and
            //   - ZERO when nothing was collected (cash / unpaid): there is no
            //     channel to charge it, so recording a fee and telling the
            //     customer one "was applied" would be a phantom charge.
            $collected = $locked->payment_status === 'paid';
            $effectiveFee = $collected
                ? round(min((float) $fresh['fee'], (float) $locked->total_amount), 2)
                : 0.0;

            $locked->update([
                'status' => 'cancelled',
                'cancelled_at' => now(),
                'cancelled_by' => $request->user()->id,
                'cancellation_reason' => $request->validated('reason'),
                'cancellation_fee' => $effectiveFee,
                // Revoke any active trip-share link so the recipient can no
                // longer poll the public endpoint for runner GPS or addresses
                // after the trip has been called off. The customer can re-share
                // a fresh link if they rebook.
                'trip_share_token' => null,
                'trip_share_active' => false,
            ]);

            // Release the promo slot this booking held — a cancelled errand
            // never completed, so it must not keep burning a use (P0-7).
            // Consumption-verified + idempotent; a no-op for non-promo bookings.
            $this->promoService->unredeem($locked->id);

            // Refund money already collected, minus the cancellation fee, to the
            // customer's wallet. Applies to wallet AND online bookings that were
            // already paid; cash bookings collected nothing so there's nothing to
            // refund. The kept fee is the platform/runner compensation.
            if ($locked->payment_status === 'paid') {
                $refundable = round(max(0, (float) $locked->total_amount - $effectiveFee), 2);
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
                            meta: ['cancellation_fee' => $effectiveFee, 'refunded_to' => 'wallet'],
                            extra: [
                                'refund_amount' => $refundable,
                                'refunded_at' => now(),
                                // Honest record: credited to wallet, not reversed to source.
                                'refunded_to' => 'wallet',
                            ],
                        );
                }
                $locked->update(['payment_status' => 'refunded']);
            }

            return null;
        });

        // The booking advanced out of the cancellable window between the unlocked
        // pre-check and the lock — reject rather than refund at a stale tier.
        if (is_array($outcome) && isset($outcome['error'])) {
            return response()->json(['message' => $outcome['error']], 422);
        }

        $booking->refresh();

        // Stop attributing the assigned runner's next ~30s of GPS pings to this
        // now-cancelled booking (RunnerLocationController caches the active
        // booking-id per runner). Mirrors the bust in RunnerErrandController.
        if ($booking->runner_id) {
            Cache::forget("runner_active_booking_id:{$booking->runner_id}");
        }

        BookingStatusLog::create([
            'booking_id' => $booking->id,
            'status' => 'cancelled',
            'changed_by' => $request->user()->id,
            'note' => $request->validated('reason'),
        ]);

        event(new BookingCancelled($booking));

        $booking->load(['errandType', 'statusLogs', 'stops']);

        // State what actually moved. A refund was credited to the wallet inside
        // the transaction above (L638-660) whenever the booking was paid; the
        // amount is total − fee. Never announce the fee without the refund —
        // the customer must never be left wondering where the rest of their
        // money went.
        // Report the fee ACTUALLY recorded (capped/zeroed above), never the raw
        // policy number, so the message can't claim a fee that wasn't charged.
        $fee = (float) $booking->cancellation_fee;
        $refunded = $booking->payment_status === 'refunded'
            ? round(max(0, (float) $booking->total_amount - $fee), 2)
            : 0.0;

        if ($refunded > 0) {
            $newBalance = number_format((float) $request->user()->fresh()->wallet_balance, 2);
            $message = $fee > 0
                ? 'Booking cancelled. A ₱'.number_format($fee, 2).' cancellation fee was applied and ₱'
                    .number_format($refunded, 2).' was refunded to your ErrandGuy wallet (new balance ₱'.$newBalance.').'
                : 'Booking cancelled. ₱'.number_format($refunded, 2)
                    .' was refunded to your ErrandGuy wallet (new balance ₱'.$newBalance.').';
        } elseif ($fee > 0) {
            $message = 'Booking cancelled. A ₱'.number_format($fee, 2)
                .' cancellation fee was applied. Nothing else was collected, so there is no refund.';
        } else {
            $message = 'Booking cancelled — no fee was charged.';
        }

        return response()->json([
            'data' => new BookingResource($booking),
            // Expose the refunded amount alongside the fee ACTUALLY charged
            // (overriding the preview fee) so the app shows a precise breakdown.
            'cancellation' => array_merge((array) $policy, ['fee' => $fee, 'refunded' => $refunded]),
            'message' => $message,
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
        // Lean poll path: `?only=location` skips the heavy eager-load (runner,
        // runner profile, status logs, errand type + the full BookingResource)
        // and returns just what the live-tracking screen consumes each tick —
        // status + the runner's latest position. The full booking is fetched
        // once on screen entry (no `only`); the 5–20s poll rides this instead,
        // and the `etag` middleware collapses unchanged ticks to a 304 on top.
        if ($request->query('only') === 'location') {
            $booking = Booking::select('id', 'status', 'payment_status', 'customer_id', 'runner_id')
                ->findOrFail($id);
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
                    'status' => $booking->status,
                    'payment_status' => $booking->payment_status,
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

        $booking = Booking::with([
            'errandType',
            'runner:id,phone,full_name,avatar_url,role,status,phone_verified,avg_rating,total_ratings,created_at',
            'runner.runnerProfile:user_id,vehicle_type,vehicle_plate,vehicle_photo_url,verification_status,acceptance_rate,completion_rate,is_online,total_errands,approved_at',
            'statusLogs',
            'stops',
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

    /**
     * GET /bookings/active — the customer's in-flight errand(s).
     *
     * `data` keeps its long-standing shape: THE one active booking (or null),
     * which is what every shipped client reads. Nothing about it changes.
     *
     * `active_bookings` is a purely ADDITIVE sibling key carrying the same
     * ranked list, capped, with `data` pointing at its first element. Nothing
     * caps concurrent bookings server-side and a days-out scheduled booking
     * stays 'active' by status, so a customer routinely has two or more — and
     * a single-row endpoint made every one but the top of the ranking
     * invisible (no card, and the customer layout subscribes its realtime
     * status channel per rendered booking). A client that knows the new key
     * can stack the cards; one that doesn't behaves exactly as before.
     */
    public function active(Request $request): JsonResponse
    {
        // Cap: the home card stack is a glance surface, not a list screen. A
        // customer with more than a few live errands still sees the top-ranked
        // ones, and the ordering below decides which those are.
        $maxActive = 3;

        $bookings = $request->user()
            ->customerBookings()
            ->with([
                'errandType',
                'runner:id,phone,full_name,avatar_url,role,status,phone_verified,avg_rating,total_ratings,created_at',
                'runner.runnerProfile:user_id,vehicle_type,vehicle_plate,vehicle_photo_url,verification_status,acceptance_rate,completion_rate,is_online,total_errands,approved_at',
                'statusLogs',
                'stops',
            ])
            ->active()
            // A booking scheduled for next week is 'active' by status, and
            // being newer it used to win this ordering outright — so placing a
            // scheduled errand HID the live one the customer had a runner
            // driving towards, and the customer layout then pointed its single
            // realtime status channel at the wrong booking, freezing the live
            // one's updates entirely. Rank anything already in (or past) its
            // matching window ahead of one still waiting for its window to
            // open; the 15-minute lead is the same one matching itself uses.
            ->orderByRaw(
                "CASE WHEN schedule_type = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at > ? THEN 1 ELSE 0 END ASC",
                [now()->addMinutes(15)],
            )
            ->orderByDesc('created_at')
            ->limit($maxActive)
            ->get();

        $first = $bookings->first();

        return response()->json([
            // Unchanged contract: the single top-ranked booking, or null.
            'data' => $first ? new BookingResource($first) : null,
            // Additive: the same rows, same ranking, same serialization, so
            // active_bookings[0] is byte-identical to `data`.
            'active_bookings' => BookingResource::collection($bookings),
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
            $validated['dropoff_lng'] ?? null,
            $validated['stops'] ?? [],
        );

        return response()->json([
            'data' => $estimates,
        ]);
    }

    public function rebook(Request $request, string $id): JsonResponse
    {
        $original = Booking::findOrFail($id);

        $this->authorize('view', $original);

        // Rebook must NOT create a live booking here. It previously created a
        // status='pending' booking and dispatched MatchRunnerJob WITHOUT
        // collecting any payment — no payment_method, no Payment row, so
        // payment_status defaulted to 'unpaid'. A runner would then be matched
        // and complete the errand for FREE: handleCompletion credits nothing
        // for a booking that is neither paid nor cash, leaving a permanent
        // completed+unpaid row, zero revenue, and an unpaid runner. Payment is
        // only ever collected inside store(); there is no pay-for-an-existing-
        // booking path. So rebook now returns a PREFILL that the client
        // re-submits through POST /bookings (store) — the single audited
        // charge+match path — instead of a divergent, payment-less clone of it.
        // (The mobile app already rebooks by re-seeding a draft and running the
        // normal paid flow, so this endpoint no longer duplicates/undercuts it.)
        $vehicleType = $original->vehicle_type_rate ?? 'motorcycle';
        $pricing = $this->pricingService->calculate(
            $original->errand_type_id,
            $original->pickup_lat,
            $original->pickup_lng,
            $original->dropoff_lat,
            $original->dropoff_lng,
            $vehicleType
        );

        return response()->json([
            'data' => [
                'prefill' => [
                    'errand_type_id' => $original->errand_type_id,
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
                    'pricing_mode' => $original->pricing_mode,
                    'vehicle_type_rate' => $vehicleType,
                    'is_transportation' => $original->is_transportation,
                ],
                'pricing' => $pricing,
            ],
            'message' => 'Submit this prefill through booking creation to rebook.',
        ]);
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

        // Reset to pending under a row lock and re-assert eligibility inside
        // the transaction. Without this, two concurrent retries (a mobile
        // double-tap) — or a retry racing a match that just landed — both read
        // the pre-match state, and the unguarded UPDATE re-opened the row while
        // leaving a stale runner_id attached, producing a duplicate offer and a
        // booking matched to two runners. A racing second retry now 409s.
        $outcome = DB::transaction(function () use ($booking, $request, $step, $radius) {
            $locked = Booking::whereKey($booking->id)->lockForUpdate()->first();

            if (! $locked) {
                return 'conflict';
            }

            // Eligibility (state + BOOK-1 money guard) is evaluated by the shared
            // BookingService::retryBlockReason so the advisory `can_retry_match`
            // flag on BookingResource can never disagree with what this endpoint
            // actually allows. Re-evaluated HERE, under the row lock, so a racing
            // retry / a match that just landed still loses.
            //
            // BOOK-1: never revive a booking whose money was already returned to
            // the customer (refunded on cancel/auto-cancel) or was never
            // collected for a non-cash charge (failed/expired). Reviving it would
            // run the errand for FREE — the customer isn't charged yet the runner
            // is paid by the platform on completion. Cash bookings hold no upfront
            // money (collected in person on completion), so they can always retry;
            // the customer must rebook instead, which creates a fresh charge.
            $blocked = \App\Services\BookingService::retryBlockReason($locked);
            if ($blocked !== null) {
                return $blocked;
            }

            $locked->update([
                'status' => 'pending',
                // Defensively clear the assignment + cancellation markers so a
                // stale runner_id can't survive the reset.
                'runner_id' => null,
                'matched_at' => null,
                'cancelled_at' => null,
                'cancellation_reason' => null,
            ]);

            BookingStatusLog::create([
                'booking_id' => $locked->id,
                'status' => 'pending',
                'changed_by' => $request->user()->id,
                'note' => sprintf('Retry match (step %d, radius %.1fkm)', $step, $radius),
            ]);

            return 'ok';
        });

        if ($outcome === 'refunded') {
            return $this->fail(
                ErrorCode::BOOKING_CONFLICT,
                'This booking was already refunded, so it can’t be retried. Please create a new booking to try again.',
            );
        }

        if ($outcome !== 'ok') {
            return $this->fail(
                ErrorCode::BOOKING_CONFLICT,
                'This booking is already in progress. Pull to refresh to see its current status.',
            );
        }

        // Run matching inline (AFTER commit — MatchRunnerJob opens its own
        // locked transaction) so the customer sees the result in the same
        // request, matching the immediate-booking path in store().
        MatchRunnerJob::dispatchSync($booking->id, $radius);

        // Re-arm auto-cancel — short window so the customer isn't left
        // hanging if this widened sweep also fails.
        $autoCancelMinutes = (int) \App\Models\SystemConfig::getValue(
            'retry_auto_cancel_timeout_minutes',
            '5',
        );
        AutoCancelBookingJob::dispatch($booking->id)
            ->delay(now()->addMinutes($autoCancelMinutes));

        // Refresh so the response reflects the just-run match result (the inline
        // MatchRunnerJob may have flipped the row to 'matched').
        $booking->refresh()->load(['errandType', 'statusLogs', 'stops']);

        return response()->json([
            'data' => new BookingResource($booking),
            'meta' => ['radius_km' => $radius, 'widen_step' => $step],
            'message' => 'Searching again with a wider radius.',
        ]);
    }

    /**
     * Customer tips their completed errand's runner. Wallet-funded, once per
     * booking, refund-safe (a separate 'tip' transaction from the fare).
     */
    public function tip(Request $request, string $id): JsonResponse
    {
        $data = $request->validate([
            'amount' => ['required', 'numeric', 'min:1', 'max:5000'],
        ]);
        $amount = round((float) $data['amount'], 2);

        $booking = Booking::where('id', $id)
            ->where('customer_id', $request->user()->id)
            ->firstOrFail();

        if (! in_array($booking->status, ['completed', 'delivered'], true)) {
            return $this->fail(ErrorCode::BOOKING_STATE_INVALID, 'You can only tip a completed errand.');
        }
        if (! $booking->runner_id) {
            return $this->fail(ErrorCode::BOOKING_STATE_INVALID, 'This errand had no runner to tip.');
        }
        // Tips work for any completed errand (incl. cash/COD) — the tip itself
        // is paid online from the customer's wallet, independent of how the fare
        // was settled.
        if ((float) $booking->tip_amount > 0) {
            return $this->fail(ErrorCode::CONFLICT, 'You’ve already tipped this errand.');
        }

        try {
            app(WalletService::class)->tip($booking->id, $booking->customer_id, $booking->runner_id, $amount);
        } catch (\RuntimeException $e) {
            return $this->fail(ErrorCode::INSUFFICIENT_WALLET_BALANCE, $e->getMessage());
        }

        \App\Jobs\SendPushJob::dispatch(
            $booking->runner_id,
            'You received a tip!',
            'Your customer added a ₱'.number_format($amount, 2)." tip for errand #{$booking->booking_number}.",
            ['type' => 'payment', 'booking_id' => $booking->id],
        );

        return $this->ok(['tip_amount' => $amount], 'Tip sent — thank you!');
    }

    /**
     * Start a GATEWAY-funded tip (GCash / Maya / card) for a completed errand.
     *
     * This is the zero-wallet / COD path: the customer pays the tip directly via
     * an online method — no wallet balance required — and the runner is credited
     * only after Xendit confirms via webhook ({@see WalletService::
     * completeGatewayTip()}). The instant wallet-funded path is {@see
     * self::tip()}. Returns a `checkout_url` the app opens to pay.
     */
    public function tipCheckout(Request $request, string $id): JsonResponse
    {
        $data = $request->validate([
            'amount' => ['required', 'numeric', 'min:1', 'max:5000'],
            'method' => ['required', 'string', \Illuminate\Validation\Rule::in(['gcash', 'maya', 'card'])],
        ]);
        $amount = round((float) $data['amount'], 2);

        $booking = Booking::where('id', $id)
            ->where('customer_id', $request->user()->id)
            ->firstOrFail();

        if (! in_array($booking->status, ['completed', 'delivered'], true)) {
            return $this->fail(ErrorCode::BOOKING_STATE_INVALID, 'You can only tip a completed errand.');
        }
        if (! $booking->runner_id) {
            return $this->fail(ErrorCode::BOOKING_STATE_INVALID, 'This errand had no runner to tip.');
        }
        // One tip per errand — same guard as the wallet path. Once a tip
        // (wallet OR gateway) has settled, tip_amount is set and this rejects a
        // second charge before any money is collected.
        if ((float) $booking->tip_amount > 0) {
            return $this->fail(ErrorCode::CONFLICT, 'You’ve already tipped this errand.');
        }

        try {
            $result = app(WalletService::class)->initiateGatewayTip(
                $booking->id,
                $booking->customer_id,
                $amount,
                $data['method'],
                $request->user()->email,
                // After paying, Xendit redirects here; the bridge forwards to the
                // app deep link so the in-app checkout sheet auto-closes.
                url('/payment/complete'),
                url('/payment/complete?status=failed'),
            );
        } catch (PaymentGatewayException $e) {
            // ApiExceptionRenderer turns this into a clean 422 with honest
            // "you weren’t charged" copy — never a Cloudflare-masked 502.
            throw $e;
        } catch (\Throwable $e) {
            return $this->fail(
                ErrorCode::PAYMENT_GATEWAY_ERROR,
                'Could not start the tip payment. You weren’t charged — please try again.',
            );
        }

        return $this->created($result['transaction'], merge: [
            // Client opens this to pay; the runner is credited only after the
            // webhook confirms settlement.
            'checkout_url' => $result['checkout_url'],
        ]);
    }
}
