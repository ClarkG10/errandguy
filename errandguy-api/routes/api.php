<?php

use App\Http\Controllers\Auth\LoginController;
use App\Http\Controllers\Auth\LogoutController;
use App\Http\Controllers\Auth\OTPController;
use App\Http\Controllers\Auth\PasswordResetController;
use App\Http\Controllers\Auth\RegisterController;
use App\Http\Controllers\Customer\BookingController;
use App\Http\Controllers\Customer\ProfileController;
use App\Http\Controllers\Customer\ReviewController;
use App\Http\Controllers\Customer\SavedAddressController;
use App\Http\Controllers\Customer\TrustedContactController;
use App\Http\Controllers\Runner\RunnerDocumentController;
use App\Http\Controllers\Runner\RunnerEarningsController;
use App\Http\Controllers\Runner\RunnerErrandController;
use App\Http\Controllers\Runner\RunnerErrandHistoryController;
use App\Http\Controllers\Runner\RunnerLocationController;
use App\Http\Controllers\Runner\RunnerOnlineController;
use App\Http\Controllers\Runner\RunnerPayoutController;
use App\Http\Controllers\Runner\RunnerProfileController;
use App\Http\Controllers\Runner\SOSController as RunnerSOSController;
use App\Http\Controllers\Chat\ChatController;
use App\Http\Controllers\Notification\NotificationController;
use App\Http\Controllers\Customer\SOSController;
use App\Http\Controllers\Customer\TripShareController;
use App\Http\Controllers\PublicTripController;
use App\Http\Controllers\Payment\PaymentMethodController;
use App\Http\Controllers\Payment\PaymentHistoryController;
use App\Http\Controllers\Payment\PaymentStatusController;
use App\Http\Controllers\Payment\XenditWebhookController;
use App\Http\Controllers\Payment\WalletController;
use App\Http\Controllers\Admin\AdminAuthController;
use App\Http\Controllers\Admin\DashboardController;
use App\Http\Controllers\Admin\UserManagementController;
use App\Http\Controllers\Admin\RunnerVerificationController;
use App\Http\Controllers\Admin\BookingManagementController;
use App\Http\Controllers\Admin\DisputeController;
use App\Http\Controllers\Admin\AdminPayoutController;
// Phase 3 additions
use App\Http\Controllers\Customer\ReferralController;
use App\Http\Controllers\Customer\PromoController;
use App\Http\Controllers\Customer\ShoppingListController;
use App\Http\Controllers\Runner\ShoppingChecklistController;
use App\Http\Controllers\Runner\HeatmapController;
use App\Http\Controllers\Support\SupportController;
use App\Http\Controllers\Export\ExportController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| API Routes — ErrandGuy
|--------------------------------------------------------------------------
| All routes are prefixed with /api/v1/
*/

Route::prefix('v1')->group(function () {

    // Auth routes (public)
    Route::prefix('auth')->group(function () {
        Route::post('/register', [RegisterController::class, 'register'])->middleware('throttle:auth');
        Route::post('/login', [LoginController::class, 'login'])->middleware('throttle:login');
        Route::post('/send-otp', [OTPController::class, 'sendOTP'])->middleware('throttle:otp');
        // verify-otp and reset-password are recovery/verify COMPLETION paths: use
        // the credential+IP 'auth-verify' limiter (like 'login'), not the
        // credential-only 'auth' limiter, so an attacker spamming a victim's
        // phone/email can't lock the legitimate user out of completing recovery
        // on their own device (AUTHX-3 class). forgot-password stays on 'auth'
        // (credential-only) to preserve its per-credential reset-email anti-bombing.
        Route::post('/verify-otp', [OTPController::class, 'verifyOTP'])->middleware('throttle:auth-verify');
        Route::post('/forgot-password', [PasswordResetController::class, 'forgotPassword'])->middleware('throttle:auth');
        Route::post('/reset-password', [PasswordResetController::class, 'resetPassword'])->middleware('throttle:auth-verify');

        Route::post('/logout', [LogoutController::class, 'logout'])->middleware('auth:sanctum');
    });

    // Public config routes (no auth required)
    Route::get('/errand-types', function (\Illuminate\Http\Request $request) {
        // Stale-while-revalidate: instant reads, refreshed in the background
        // ~hourly so admin edits propagate without a 24h wait or a cron.
        $response = response()->json([
            'data' => \App\Services\CacheService::swr(\App\Services\CacheService::errandTypesKey(), 3600, 86400, fn () =>
                \App\Models\ErrandType::where('is_active', true)->orderBy('sort_order')->get()->toArray()
            ),
        ]);

        // This is a PUBLIC catalog (no user ⇒ SecurityHeaders won't stamp
        // no-store), so make it edge/browser-cacheable with a content ETag →
        // cheap 304s instead of re-shipping the full body. A short edge max-age
        // (5min) keeps admin catalog-edit propagation quick despite the ~1h
        // server SWR; stale-while-revalidate lets stale copies serve instantly
        // while revalidating. `isNotModified` flips the response to a bodyless
        // 304 when the client's If-None-Match matches. (P22)
        $response->headers->set('Cache-Control', 'public, max-age=300, stale-while-revalidate=86400');
        $response->setEtag(md5($response->getContent()));
        $response->isNotModified($request);

        return $response;
    });

    // Authenticated routes
    Route::middleware(['auth:sanctum', 'active'])->group(function () {

        // Client (mobile) crash ingest — best-effort observability so release-
        // build crashes (where console.* goes nowhere) become a visible,
        // alertable server-side signal. Throttled so a crash-looping client
        // cannot flood the log.
        Route::post('/client-errors', [\App\Http\Controllers\ClientErrorController::class, 'store'])
            ->middleware('throttle:30,1');

        // User profile routes
        Route::prefix('user')->group(function () {
            Route::get('/profile', [ProfileController::class, 'show']);
            Route::put('/profile', [ProfileController::class, 'update']);
            Route::post('/avatar', [ProfileController::class, 'uploadAvatar']);
            Route::put('/fcm-token', [ProfileController::class, 'updateFCMToken']);
            Route::delete('/account', [ProfileController::class, 'deleteAccount']);

            Route::get('/addresses', [SavedAddressController::class, 'index']);
            Route::post('/addresses', [SavedAddressController::class, 'store']);
            Route::put('/addresses/{id}', [SavedAddressController::class, 'update']);
            Route::delete('/addresses/{id}', [SavedAddressController::class, 'destroy']);

            Route::get('/trusted-contacts', [TrustedContactController::class, 'index']);
            Route::post('/trusted-contacts', [TrustedContactController::class, 'store']);
            Route::put('/trusted-contacts/{id}', [TrustedContactController::class, 'update']);
            Route::delete('/trusted-contacts/{id}', [TrustedContactController::class, 'destroy']);

            // Referral program
            Route::get('/referral', [ReferralController::class, 'show']);
            Route::post('/referral/apply', [ReferralController::class, 'apply'])->middleware('throttle:10,1');
        });

        // Customer Home in ONE round trip (errand types + active booking +
        // recent bookings + wallet balance + promos + referral). Each section
        // is byte-identical to the individual endpoint that still serves it,
        // so the app seeds its existing caches from this and keeps the
        // per-resource routes as revalidation paths. (A7)
        Route::middleware(['role:customer'])->get('/customer/home', [\App\Http\Controllers\Customer\HomeController::class, 'show']);

        // Customer booking routes
        Route::middleware(['role:customer'])->prefix('bookings')->group(function () {
            Route::get('/', [BookingController::class, 'index']);
            // Cap booking creation to deter spam/scripted floods. Real users
            // never need more than a handful per minute. `idempotent` makes a
            // double-tap / network retry with the same Idempotency-Key return
            // the original booking+checkout instead of creating a second one.
            Route::post('/', [BookingController::class, 'store'])->middleware(['throttle:15,1', 'idempotent']);
            // Attach item photos to a just-created booking. The create body is
            // JSON (no file parts), so the customer's staged photos are uploaded
            // here immediately after. Owner-gated, pre-pickup only.
            Route::post('/{id}/item-photos', [BookingController::class, 'uploadItemPhotos'])
                ->middleware('throttle:10,1');
            Route::get('/active', [BookingController::class, 'active']);
            Route::post('/estimate', [BookingController::class, 'estimate']);
            Route::get('/{id}', [BookingController::class, 'show']);
            Route::get('/{id}/cancel-preview', [BookingController::class, 'cancelPreview']);
            Route::post('/{id}/cancel', [BookingController::class, 'cancel']);
            Route::get('/{id}/track', [BookingController::class, 'track'])->middleware('etag');
            // Payment settlement status for this booking (deep-link verify path).
            Route::get('/{id}/payment-status', [PaymentStatusController::class, 'forBooking'])
                ->where('id', '[0-9a-fA-F-]{36}');
            Route::post('/{id}/review', [ReviewController::class, 'store']);
            Route::post('/{id}/rebook', [BookingController::class, 'rebook']);
            Route::post('/{id}/tip', [BookingController::class, 'tip'])->middleware('throttle:10,1');
            // Gateway-funded tip (GCash/Maya/card) — the zero-wallet / COD path.
            // Returns a checkout_url; the runner is credited on the Xendit webhook.
            Route::post('/{id}/tip-checkout', [BookingController::class, 'tipCheckout'])->middleware('throttle:10,1');
            // Retry-match is rate-limited tighter than the broader booking
            // endpoints — a frantically tapping user shouldn't be able to
            // re-dispatch MatchRunnerJob more than once every few seconds.
            Route::post('/{id}/retry-match', [BookingController::class, 'retryMatch'])
                ->middleware('throttle:6,1');
            Route::post('/{id}/sos', [SOSController::class, 'trigger'])->middleware('throttle:6,1');
            Route::delete('/{id}/sos', [SOSController::class, 'deactivate'])->middleware('throttle:10,1');
            Route::post('/{id}/share-trip', [TripShareController::class, 'share']);
            Route::delete('/{id}/share-trip', [TripShareController::class, 'revoke']);
            // Customer edits the shopping checklist while the errand is pre-pickup.
            Route::put('/{id}/shopping-items', [ShoppingListController::class, 'update']);
        });

        // Runner routes
        Route::prefix('runner')->middleware(['role:runner'])->group(function () {
            Route::get('/profile', [RunnerProfileController::class, 'show']);
            Route::put('/profile', [RunnerProfileController::class, 'update']);
            Route::post('/documents', [RunnerDocumentController::class, 'store']);
            // A runner streams their OWN KYC document (private kyc disk, owner-gated).
            Route::get('/documents/{document}/file', [\App\Http\Controllers\RunnerDocumentFileController::class, 'ownerShow'])
                ->name('runner.documents.file');
            Route::put('/online', [RunnerOnlineController::class, 'toggle']);
            Route::post('/location', [RunnerLocationController::class, 'store'])->middleware('throttle:120,1');

            Route::get('/errand/current', [RunnerErrandController::class, 'current'])->middleware('etag');
            Route::get('/errand/available', [RunnerErrandController::class, 'available'])->middleware('etag');
            Route::get('/errand/{id}', [RunnerErrandController::class, 'show'])
                ->where('id', '[0-9a-fA-F-]{36}')
                ->middleware('etag');
            Route::post('/errand/{id}/accept', [RunnerErrandController::class, 'accept']);
            Route::post('/errand/{id}/decline', [RunnerErrandController::class, 'decline']);
            Route::post('/errand/{id}/status', [RunnerErrandController::class, 'updateStatus']);
            Route::post('/errand/{id}/verify-pin', [RunnerErrandController::class, 'verifyPin']);

            Route::get('/earnings', [RunnerEarningsController::class, 'summary']);
            Route::get('/earnings/history', [RunnerEarningsController::class, 'history']);
            // Throttled: synchronous DomPDF rendering of up to 500 line items
            // pins a PHP-FPM worker for seconds, so a retry storm / rapid taps
            // could starve the pool. 6/min per runner is ample for a real
            // statement export. (The fuller fix — render in a queued job and
            // hand back a signed URL — changes this endpoint's contract from a
            // binary stream and needs a coordinated mobile change; see P17.)
            Route::get('/earnings/export', [ExportController::class, 'earningsPdf'])
                ->middleware('throttle:6,1');
            Route::get('/errands/history', [RunnerErrandHistoryController::class, 'index'])->middleware('etag');
            // Money-OUT endpoint. Throttled (a runner needs at most a couple
            // per minute) and `idempotent:required` — a payout request without
            // an Idempotency-Key is refused (428) rather than risk a
            // double-debit; the key also becomes the payout's stable
            // reference_id so the DB unique guard is the final backstop (P0-8).
            Route::post('/payout/request', [RunnerPayoutController::class, 'requestPayout'])
                ->middleware(['throttle:10,1', 'idempotent:required']);

            // Runner toggles shopping-checklist ticks while shopping.
            Route::patch('/errand/{id}/shopping-items', [ShoppingChecklistController::class, 'update']);
            // Demand heatmap + peak-hours (cached aggregates).
            Route::get('/heatmap', [HeatmapController::class, 'heatmap']);
            Route::get('/peak-hours', [HeatmapController::class, 'peakHours']);

            // Runner-side review of the customer. The controller itself is
            // role-agnostic (see ReviewController::store) — gating is done
            // by BookingPolicy::review which now allows either party.
            Route::post('/errand/{id}/review', [ReviewController::class, 'store']);

            // Runner-side SOS (only valid while owning an in-flight booking)
            Route::post('/errand/{id}/sos', [RunnerSOSController::class, 'trigger'])->middleware('throttle:6,1');
            Route::delete('/errand/{id}/sos', [RunnerSOSController::class, 'deactivate'])->middleware('throttle:10,1');
        });

        // Chat routes
        Route::prefix('chat')->group(function () {
            Route::get('/unread-count', [ChatController::class, 'unreadCount']);
            Route::get('/conversations', [ChatController::class, 'conversations']);
            Route::get('/{bookingId}/messages', [ChatController::class, 'index'])->middleware('etag');
            Route::post('/{bookingId}/messages', [ChatController::class, 'store'])->middleware('throttle:60,1');
            Route::post('/{bookingId}/read', [ChatController::class, 'markAsRead']);
        });

        // Payment routes
        Route::prefix('payments')->group(function () {
            // Platform-offered methods (operator-managed via admin).
            Route::get('/available-methods', [PaymentMethodController::class, 'available']);
            Route::get('/methods', [PaymentMethodController::class, 'index']);
            Route::post('/methods', [PaymentMethodController::class, 'store']);
            // Link a reusable e-wallet (GCash/Maya/GrabPay) → returns an
            // authorization URL the app opens in an in-app sheet.
            Route::post('/methods/link', [PaymentMethodController::class, 'link'])->middleware('throttle:10,1');
            Route::delete('/methods/{id}', [PaymentMethodController::class, 'destroy']);
            Route::put('/methods/{id}/default', [PaymentMethodController::class, 'setDefault']);
            Route::get('/history', [PaymentHistoryController::class, 'index']);
            // Cheap status probe the app polls to verify a charge (never assume).
            Route::get('/{id}/status', [PaymentStatusController::class, 'show'])
                ->where('id', '[0-9a-fA-F-]{36}');
            Route::get('/{id}/receipt', [PaymentHistoryController::class, 'receipt']);
            Route::get('/{id}/receipt/pdf', [ExportController::class, 'receiptPdf'])
                ->middleware('throttle:6,1');
        });

        // Wallet routes
        Route::prefix('wallet')->group(function () {
            Route::get('/balance', [WalletController::class, 'balance']);
            // Financial endpoint — strict rate-limit on top-up to deter
            // abuse / accidental double-tap charges. `idempotent` makes a
            // retried top-up with the same key return the original pending
            // invoice instead of opening a second one.
            Route::post('/top-up', [WalletController::class, 'topUp'])->middleware(['throttle:5,1', 'idempotent']);
            Route::get('/transactions', [WalletController::class, 'transactions']);
            // Status probe for a single top-up (the app polls to verify).
            Route::get('/transactions/{id}/status', [WalletController::class, 'transactionStatus'])
                ->where('id', '[0-9a-fA-F-]{36}');
        });

        // Notification routes
        Route::prefix('notifications')->group(function () {
            Route::get('/', [NotificationController::class, 'index'])->middleware('etag');
            Route::get('/unread-count', [NotificationController::class, 'unreadCount']);
            Route::put('/{id}/read', [NotificationController::class, 'markAsRead']);
            Route::put('/read-all', [NotificationController::class, 'markAllAsRead']);
            Route::put('/{id}/archive', [NotificationController::class, 'archive']);
            Route::put('/{id}/unarchive', [NotificationController::class, 'unarchive']);
            Route::delete('/', [NotificationController::class, 'clearAll']);
            Route::delete('/{id}', [NotificationController::class, 'destroy']);
        });

        // Config routes (cached for performance)
        Route::get('/config/app', function () {
            return response()->json([
                'data' => \App\Services\CacheService::rememberStatic('app_config', fn () =>
                    \App\Models\SystemConfig::pluck('value', 'key')
                ),
            ]);
        });

        // Promo code validation. Delegates to PromoService so the same
        // global-limit, per-user-limit, and validity-window checks that
        // run at booking-create time also run here — otherwise the UI
        // would happily accept a code the server will later reject.
        Route::get('/promos/validate/{code}', function (string $code, \Illuminate\Http\Request $request) {
            $service = app(\App\Services\PromoService::class);
            // Optional `?amount=N` lets the client preview discount + check
            // min_order. Defaults to 0 (skips min_order via PromoService
            // contract).
            $amount = (float) $request->query('amount', 0);
            try {
                $result = $service->validate($code, $request->user()->id, $amount);
            } catch (\InvalidArgumentException $e) {
                return response()->json(['message' => $e->getMessage()], 422);
            }
            return response()->json([
                'data' => [
                    'id' => $result['id'],
                    'code' => $result['code'],
                    'discount_type' => $result['discount_type'],
                    'discount_value' => $result['discount_value'],
                    'max_discount' => $result['max_discount'],
                    'description' => $result['description'],
                    'discount' => $result['discount'],
                ],
            ]);
        });

        // Browse currently-valid, publicly-listable promo codes.
        Route::get('/promos', [PromoController::class, 'index']);

        // Live-support tickets (threaded successor to /support/report below).
        Route::prefix('support')->group(function () {
            Route::get('/tickets', [SupportController::class, 'index']);
            Route::post('/tickets', [SupportController::class, 'store'])->middleware('throttle:15,1');
            Route::get('/tickets/{id}', [SupportController::class, 'show'])
                ->where('id', '[0-9a-fA-F-]{36}');
            Route::post('/tickets/{id}/messages', [SupportController::class, 'postMessage'])
                ->where('id', '[0-9a-fA-F-]{36}')
                ->middleware('throttle:60,1');
        });

        // Support report (legacy one-shot dispute intake — kept for back-compat)
        Route::post('/support/report', function (\Illuminate\Http\Request $request) {
            $validated = $request->validate([
                // Scope by ownership so a user can't open a dispute referencing
                // a stranger's booking (mirrors CreateTicketRequest). This is a
                // route closure, so the subquery closure must `use ($request)`.
                'booking_id' => [
                    'nullable',
                    'uuid',
                    \Illuminate\Validation\Rule::exists('bookings', 'id')->where(function ($query) use ($request) {
                        $query->where('customer_id', $request->user()->id)
                            ->orWhere('runner_id', $request->user()->id);
                    }),
                ],
                'subject' => ['required', 'string', 'max:200'],
                'description' => ['required', 'string', 'max:2000'],
                'category' => ['required', 'string', 'max:50'],
            ]);

            $ticket = \App\Models\DisputeTicket::create([
                'booking_id' => $validated['booking_id'] ?? null,
                'reported_by' => $request->user()->id,
                'category' => $validated['category'],
                'description' => "[{$validated['subject']}] {$validated['description']}",
                'status' => 'open',
            ]);

            return response()->json([
                'data' => $ticket,
                'message' => 'Report submitted successfully.',
            ], 201);
        })->middleware('throttle:15,1');
        // ^ Match the modern /support/tickets sibling: this legacy route also
        //   writes a DisputeTicket into the ops moderation queue, so cap it the
        //   same way instead of leaving it on the 240/min global api limiter.
    });

    // Admin routes
    Route::prefix('admin')->group(function () {
        // Credential+IP limiter (NOT the credential-only 'auth' limiter): keying
        // admin login on the email alone let anyone who knew an admin's email lock
        // that admin out of the ops console with 5 junk attempts — the AUTHX-3
        // pre-auth DoS the user-login route already avoids. (audit v4 security)
        Route::post('/login', [AdminAuthController::class, 'login'])->middleware('throttle:login');

        Route::middleware(['auth:sanctum', 'admin'])->group(function () {
            Route::post('/logout', [AdminAuthController::class, 'logout']);
            Route::get('/me', [AdminAuthController::class, 'me']);

            Route::get('/dashboard/stats', [DashboardController::class, 'stats']);

            Route::get('/users', [UserManagementController::class, 'index']);
            Route::get('/users/{id}', [UserManagementController::class, 'show']);
            // Account/errand moderation + runner verification — super_admin/admin/
            // ops only (canModerate), mirroring the Filament Users/Bookings/
            // RunnerProfiles action gates. This EXCLUDES support and finance:
            // support handles disputes/tickets/SOS, not account/booking moderation,
            // and admin booking-cancel issues a full wallet refund.
            Route::post('/users/{id}/suspend', [UserManagementController::class, 'suspend'])->middleware('admin.can:moderate');
            Route::post('/users/{id}/unsuspend', [UserManagementController::class, 'unsuspend'])->middleware('admin.can:moderate');

            // Runner KYC reads expose government-ID / selfie metadata (and, for
            // any un-migrated legacy row, a raw file_url). Gate the READS to
            // moderation roles (super_admin/admin/ops) to match their approve/
            // reject siblings and the byte-stream gate in
            // RunnerDocumentFileController::adminShow — finance/support must never
            // see runner KYC.
            Route::get('/runners/pending', [RunnerVerificationController::class, 'pending'])->middleware('admin.can:moderate');
            Route::get('/runners/{userId}/documents', [RunnerVerificationController::class, 'showDocuments'])->middleware('admin.can:moderate');
            Route::post('/runners/{userId}/approve', [RunnerVerificationController::class, 'approve'])->middleware('admin.can:moderate');
            Route::post('/runners/{userId}/reject', [RunnerVerificationController::class, 'reject'])->middleware('admin.can:moderate');

            Route::get('/bookings', [BookingManagementController::class, 'index']);
            Route::get('/bookings/{id}', [BookingManagementController::class, 'show']);
            Route::post('/bookings/{id}/cancel', [BookingManagementController::class, 'cancel'])->middleware('admin.can:moderate');

            // Disputes — super_admin/admin/support/ops (canHandleSupport), mirroring
            // the Filament DisputeTicketResource gate (support IS permitted here).
            // The READ routes were previously ungated, so a finance-role admin
            // (canManageMoney but NOT canHandleSupport) — blocked from disputes in
            // the panel — could still list/read dispute PII (both parties' phone +
            // email) over the API. Gate the reads to match the mutating routes.
            Route::get('/disputes', [DisputeController::class, 'index'])->middleware('admin.can:support');
            Route::get('/disputes/{id}', [DisputeController::class, 'show'])->middleware('admin.can:support');
            Route::post('/disputes/{id}/resolve', [DisputeController::class, 'resolve'])->middleware('admin.can:support');
            Route::post('/disputes/{id}/escalate', [DisputeController::class, 'escalate'])->middleware('admin.can:support');

            // Money surfaces — finance/super_admin only, mirroring the Filament
            // Payouts + PlatformPaymentMethods pages (canManageMoney). The list
            // read is money-gated too: it returns the full payout ledger +
            // runner PII (name/phone) that support/ops must not see over the API.
            Route::get('/payouts', [AdminPayoutController::class, 'index'])->middleware('admin.can:money');
            Route::post('/payouts/{id}/complete', [AdminPayoutController::class, 'markCompleted'])->middleware('admin.can:money');
            Route::post('/payouts/{id}/fail', [AdminPayoutController::class, 'markFailed'])->middleware('admin.can:money');

            // Manage which payment methods the platform offers.
            Route::get('/payment-methods', [\App\Http\Controllers\Admin\PaymentSettingController::class, 'index']);
            Route::put('/payment-methods', [\App\Http\Controllers\Admin\PaymentSettingController::class, 'update'])->middleware('admin.can:money');
        });
    });

    // Webhook routes (no auth, token-verified)
    Route::post('/webhooks/xendit', [XenditWebhookController::class, 'handle']);

    // Public trip tracking (no auth, rate limited)
    Route::get('/trip/{token}', [PublicTripController::class, 'show'])->middleware('throttle:60,1');
});
