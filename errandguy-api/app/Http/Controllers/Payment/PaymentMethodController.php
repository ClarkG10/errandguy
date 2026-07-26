<?php

namespace App\Http\Controllers\Payment;

use App\Exceptions\PaymentGatewayException;
use App\Http\Controllers\Controller;
use App\Models\PaymentMethod;
use App\Services\CacheService;
use App\Services\PaymentMethodCatalog;
use App\Services\PaymentService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PaymentMethodController extends Controller
{
    /**
     * The payment methods currently OFFERED by the platform (operator-managed
     * via admin). The app renders exactly this set in its selector so a
     * disabled method never appears. Cached with background refresh.
     */
    public function available(): JsonResponse
    {
        return response()->json([
            'data' => CacheService::swr(
                'payments:available_methods',
                300,   // fresh 5 min
                3600,  // survive 1 h
                fn () => PaymentMethodCatalog::enabled(),
            ),
        ]);
    }

    public function index(Request $request): JsonResponse
    {
        // Hide expired/failed links — they can't be used and only confuse.
        $methods = PaymentMethod::where('user_id', $request->user()->id)
            ->whereIn('status', ['active', 'pending'])
            ->orderByDesc('is_default')
            ->orderBy('created_at')
            ->get()
            ->makeHidden(['gateway_token', 'gateway_ref']);

        return response()->json([
            'data' => $methods,
        ]);
    }

    /**
     * Start linking a reusable e-wallet (GCash / Maya / GrabPay). Creates a
     * PENDING method row + a Xendit payment method, and returns an
     * `action_url` the app opens (in-app sheet) for the customer to authorize.
     * The `payment_method.activated` webhook flips it to ACTIVE.
     */
    public function link(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'channel' => ['required', 'string', 'in:gcash,maya,grabpay'],
        ]);

        $user = $request->user();
        $channel = $validated['channel'];
        $channelMap = ['gcash' => 'GCASH', 'maya' => 'PAYMAYA', 'grabpay' => 'GRABPAY'];
        $labelMap = ['gcash' => 'GCash', 'maya' => 'Maya', 'grabpay' => 'GrabPay'];

        try {
            $pm = app(PaymentService::class)->createLinkedEwallet(
                $user,
                $channelMap[$channel],
                // Reuse the payment-return bridge so the in-app sheet auto-closes
                // once the customer finishes authorizing in the e-wallet.
                url('/payment/complete'),
                url('/payment/complete'),
            );
        } catch (PaymentGatewayException $e) {
            // A gateway REJECTION (validation, unsupported channel, missing
            // field) is not an origin outage. Returning a raw 502 both
            // mislabels it AND gets intercepted by Cloudflare, which swaps our
            // JSON for its own branded 502 page — so the app never sees the
            // real reason (this masked a one-line payload bug as an "infra"
            // incident). Return 422 so the message flows through. The detailed
            // reason is already logged server-side in PaymentService regardless
            // of APP_DEBUG; only expose it to the client while debugging.
            $message = config('app.debug')
                ? "Payment gateway error: {$e->reason()}"
                : 'Could not start linking. Please try again.';

            return response()->json(['message' => $message], 422);
        } catch (\Throwable $e) {
            // Genuinely unexpected failure (not a gateway rejection) — keep a
            // 502 and report it so it surfaces in logs/monitoring.
            report($e);

            return response()->json(
                ['message' => 'Could not start linking. Please try again.'],
                502,
            );
        }

        $status = strtolower($pm['status'] ?? 'pending') === 'active' ? 'active' : 'pending';
        $isFirstActive = ! PaymentMethod::where('user_id', $user->id)
            ->where('status', 'active')
            ->exists();

        $method = PaymentMethod::create([
            'user_id' => $user->id,
            'type' => $channel,
            'status' => $status,
            'label' => $labelMap[$channel],
            'gateway_ref' => $pm['id'] ?? null,
            'channel_code' => $channelMap[$channel],
            'is_default' => $isFirstActive && $status === 'active',
        ]);

        return response()->json([
            'data' => $method->makeHidden(['gateway_token', 'gateway_ref']),
            // The app opens this to authorize the link; null if already active.
            'action_url' => PaymentService::extractActionUrl($pm),
        ], 201);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'type' => ['required', 'string', 'in:card,gcash,maya'],
            'gateway_token' => ['required', 'string', 'max:500'],
            'label' => ['nullable', 'string', 'max:100'],
            'last_four' => ['nullable', 'string', 'max:4'],
            'card_brand' => ['nullable', 'string', 'max:20'],
            'expires_at' => ['nullable', 'date'],
        ]);

        $user = $request->user();

        $isFirst = !PaymentMethod::where('user_id', $user->id)->exists();

        $method = PaymentMethod::create([
            'user_id' => $user->id,
            'type' => $validated['type'],
            'gateway_token' => $validated['gateway_token'],
            'label' => $validated['label'] ?? ucfirst($validated['type']),
            'last_four' => $validated['last_four'] ?? null,
            'card_brand' => $validated['card_brand'] ?? null,
            'expires_at' => $validated['expires_at'] ?? null,
            'is_default' => $isFirst,
        ]);

        return response()->json([
            'data' => $method->makeHidden(['gateway_token']),
        ], 201);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $method = PaymentMethod::where('user_id', $request->user()->id)
            ->findOrFail($id);

        $wasDefault = $method->is_default;
        $method->delete();

        if ($wasDefault) {
            PaymentMethod::where('user_id', $request->user()->id)
                ->orderBy('created_at')
                ->first()
                ?->update(['is_default' => true]);
        }

        return response()->json([
            'message' => 'Payment method removed.',
        ]);
    }

    public function setDefault(Request $request, string $id): JsonResponse
    {
        $user = $request->user();

        PaymentMethod::where('user_id', $user->id)
            ->update(['is_default' => false]);

        PaymentMethod::where('user_id', $user->id)
            ->where('id', $id)
            ->update(['is_default' => true]);

        return response()->json([
            'message' => 'Default payment method updated.',
        ]);
    }
}
