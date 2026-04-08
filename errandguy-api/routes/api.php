<?php

use App\Http\Controllers\Auth\LoginController;
use App\Http\Controllers\Auth\LogoutController;
use App\Http\Controllers\Auth\OTPController;
use App\Http\Controllers\Auth\PasswordResetController;
use App\Http\Controllers\Auth\RegisterController;
use App\Http\Controllers\Auth\SocialLoginController;
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
use App\Http\Controllers\Chat\ChatController;
use App\Http\Controllers\Notification\NotificationController;
use App\Http\Controllers\Customer\SOSController;
use App\Http\Controllers\Customer\TripShareController;
use App\Http\Controllers\PublicTripController;
use App\Http\Controllers\Payment\PaymentMethodController;
use App\Http\Controllers\Payment\PaymentHistoryController;
use App\Http\Controllers\Payment\PayMongoWebhookController;
use App\Http\Controllers\Payment\WalletController;
use App\Http\Controllers\Admin\AdminAuthController;
use App\Http\Controllers\Admin\DashboardController;
use App\Http\Controllers\Admin\UserManagementController;
use App\Http\Controllers\Admin\RunnerVerificationController;
use App\Http\Controllers\Admin\BookingManagementController;
use App\Http\Controllers\Admin\DisputeController;
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
        Route::post('/login', [LoginController::class, 'login'])->middleware('throttle:auth');
        Route::post('/send-otp', [OTPController::class, 'sendOTP'])->middleware('throttle:otp');
        Route::post('/verify-otp', [OTPController::class, 'verifyOTP'])->middleware('throttle:auth');
        Route::post('/social-login', [SocialLoginController::class, 'login'])->middleware('throttle:auth');
        Route::post('/forgot-password', [PasswordResetController::class, 'forgotPassword'])->middleware('throttle:auth');
        Route::post('/reset-password', [PasswordResetController::class, 'resetPassword'])->middleware('throttle:auth');

        Route::post('/logout', [LogoutController::class, 'logout'])->middleware('auth:sanctum');
    });

    // Authenticated routes
    Route::middleware(['auth:sanctum', 'active'])->group(function () {

        // User profile routes
        Route::prefix('user')->group(function () {
            Route::get('/profile', [ProfileController::class, 'show']);
            Route::put('/profile', [ProfileController::class, 'update']);
            Route::post('/avatar', [ProfileController::class, 'uploadAvatar']);
            Route::put('/fcm-token', [ProfileController::class, 'updateFCMToken']);
            Route::delete('/account', [ProfileController::class, 'deleteAccount']);

            Route::get('/addresses', [SavedAddressController::class, 'index']);
            Route::post('/addresses', [SavedAddressController::class, 'store']);
            Route::delete('/addresses/{id}', [SavedAddressController::class, 'destroy']);

            Route::get('/trusted-contacts', [TrustedContactController::class, 'index']);
            Route::post('/trusted-contacts', [TrustedContactController::class, 'store']);
            Route::put('/trusted-contacts/{id}', [TrustedContactController::class, 'update']);
            Route::delete('/trusted-contacts/{id}', [TrustedContactController::class, 'destroy']);
        });

        // Customer booking routes
        Route::middleware(['role:customer'])->prefix('bookings')->group(function () {
            Route::get('/', [BookingController::class, 'index']);
            Route::post('/', [BookingController::class, 'store']);
            Route::get('/active', [BookingController::class, 'active']);
            Route::post('/estimate', [BookingController::class, 'estimate']);
            Route::get('/{id}', [BookingController::class, 'show']);
            Route::post('/{id}/cancel', [BookingController::class, 'cancel']);
            Route::get('/{id}/track', [BookingController::class, 'track']);
            Route::post('/{id}/review', [ReviewController::class, 'store']);
            Route::post('/{id}/rebook', [BookingController::class, 'rebook']);
            Route::post('/{id}/sos', [SOSController::class, 'trigger']);
            Route::delete('/{id}/sos', [SOSController::class, 'deactivate']);
            Route::post('/{id}/share-trip', [TripShareController::class, 'share']);
            Route::delete('/{id}/share-trip', [TripShareController::class, 'revoke']);
        });

        // Runner routes
        Route::prefix('runner')->middleware(['role:runner'])->group(function () {
            Route::get('/profile', [RunnerProfileController::class, 'show']);
            Route::put('/profile', [RunnerProfileController::class, 'update']);
            Route::post('/documents', [RunnerDocumentController::class, 'store']);
            Route::put('/online', [RunnerOnlineController::class, 'toggle']);
            Route::post('/location', [RunnerLocationController::class, 'store']);

            Route::get('/errand/current', [RunnerErrandController::class, 'current']);
            Route::post('/errand/{id}/accept', [RunnerErrandController::class, 'accept']);
            Route::post('/errand/{id}/decline', [RunnerErrandController::class, 'decline']);
            Route::get('/errand/available', [RunnerErrandController::class, 'available']);
            Route::post('/errand/{id}/status', [RunnerErrandController::class, 'updateStatus']);
            Route::post('/errand/{id}/verify-pin', [RunnerErrandController::class, 'verifyPin']);

            Route::get('/earnings', [RunnerEarningsController::class, 'summary']);
            Route::get('/earnings/history', [RunnerEarningsController::class, 'history']);
            Route::get('/errands/history', [RunnerErrandHistoryController::class, 'index']);
            Route::post('/payout/request', [RunnerPayoutController::class, 'requestPayout']);
        });

        // Chat routes
        Route::prefix('chat')->group(function () {
            Route::get('/{bookingId}/messages', [ChatController::class, 'index']);
            Route::post('/{bookingId}/messages', [ChatController::class, 'store']);
            Route::post('/{bookingId}/read', [ChatController::class, 'markAsRead']);
        });

        // Payment routes
        Route::prefix('payments')->group(function () {
            Route::get('/methods', [PaymentMethodController::class, 'index']);
            Route::post('/methods', [PaymentMethodController::class, 'store']);
            Route::delete('/methods/{id}', [PaymentMethodController::class, 'destroy']);
            Route::put('/methods/{id}/default', [PaymentMethodController::class, 'setDefault']);
            Route::get('/history', [PaymentHistoryController::class, 'index']);
            Route::get('/{id}/receipt', [PaymentHistoryController::class, 'receipt']);
        });

        // Wallet routes
        Route::prefix('wallet')->group(function () {
            Route::get('/balance', [WalletController::class, 'balance']);
            Route::post('/top-up', [WalletController::class, 'topUp']);
            Route::get('/transactions', [WalletController::class, 'transactions']);
        });

        // Notification routes
        Route::prefix('notifications')->group(function () {
            Route::get('/', [NotificationController::class, 'index']);
            Route::get('/unread-count', [NotificationController::class, 'unreadCount']);
            Route::put('/{id}/read', [NotificationController::class, 'markAsRead']);
            Route::put('/read-all', [NotificationController::class, 'markAllAsRead']);
        });

        // Config routes (cached for performance)
        Route::get('/errand-types', function () {
            return response()->json([
                'data' => \App\Services\CacheService::rememberStatic('errand_types:active', fn () =>
                    \App\Models\ErrandType::where('is_active', true)->orderBy('sort_order')->get()
                ),
            ]);
        });

        Route::get('/config/app', function () {
            return response()->json([
                'data' => \App\Services\CacheService::rememberStatic('app_config', fn () =>
                    \App\Models\SystemConfig::pluck('value', 'key')
                ),
            ]);
        });
    });

    // Admin routes
    Route::prefix('admin')->group(function () {
        Route::post('/login', [AdminAuthController::class, 'login'])->middleware('throttle:auth');

        Route::middleware(['auth:sanctum', 'admin'])->group(function () {
            Route::post('/logout', [AdminAuthController::class, 'logout']);
            Route::get('/me', [AdminAuthController::class, 'me']);

            Route::get('/dashboard/stats', [DashboardController::class, 'stats']);

            Route::get('/users', [UserManagementController::class, 'index']);
            Route::get('/users/{id}', [UserManagementController::class, 'show']);
            Route::post('/users/{id}/suspend', [UserManagementController::class, 'suspend']);
            Route::post('/users/{id}/unsuspend', [UserManagementController::class, 'unsuspend']);

            Route::get('/runners/pending', [RunnerVerificationController::class, 'pending']);
            Route::get('/runners/{userId}/documents', [RunnerVerificationController::class, 'showDocuments']);
            Route::post('/runners/{userId}/approve', [RunnerVerificationController::class, 'approve']);
            Route::post('/runners/{userId}/reject', [RunnerVerificationController::class, 'reject']);

            Route::get('/bookings', [BookingManagementController::class, 'index']);
            Route::get('/bookings/{id}', [BookingManagementController::class, 'show']);
            Route::post('/bookings/{id}/cancel', [BookingManagementController::class, 'cancel']);

            Route::get('/disputes', [DisputeController::class, 'index']);
            Route::get('/disputes/{id}', [DisputeController::class, 'show']);
            Route::post('/disputes/{id}/resolve', [DisputeController::class, 'resolve']);
            Route::post('/disputes/{id}/escalate', [DisputeController::class, 'escalate']);
        });
    });

    // Webhook routes (no auth, signature-verified)
    Route::post('/webhooks/paymongo', [PayMongoWebhookController::class, 'handle']);

    // Public trip tracking (no auth, rate limited)
    Route::get('/trip/{token}', [PublicTripController::class, 'show'])->middleware('throttle:60,1');
});
