<?php

namespace App\Http\Controllers\Payment;

use App\Exceptions\PaymentGatewayException;
use App\Http\Controllers\Controller;
use App\Models\PaymentMethod;
use App\Services\CacheService;
use App\Services\PaymentMethodCatalog;
use App\Services\PaymentService;
use App\Support\ErrorCode;
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
        return $this->ok(CacheService::swr(
            'payments:available_methods',
            300,   // fresh 5 min
            3600,  // survive 1 h
            fn () => PaymentMethodCatalog::enabled(),
        ));
    }

    public function index(Request $request): JsonResponse
    {
        // Hide expired/failed links — they can't be used and only confuse.
        $methods = PaymentMethod::where('user_id', $request->user()->id)
            ->whereIn('status', ['active', 'pending'])
            ->orderByDesc('is_default')
            ->orderBy('created_at')
            ->get();

        // Confirm any still-`pending` linked method directly with the gateway so
        // linking completes even when the `payment_method.activated` webhook is
        // delayed or (in test mode) never configured — the app refetches this
        // list the moment the authorization sheet closes. Idempotent + throttled
        // per method. This is what turns a stuck-`pending` link into an `active`
        // one the customer can then be charged against WITHOUT another redirect.
        $svc = app(PaymentService::class);
        foreach ($methods as $method) {
            if ($method->status === 'pending') {
                $svc->reconcileLinkedMethod($method);
            }
        }

        // Drop anything that reconciled to a terminal-failure state.
        $methods = $methods
            ->whereIn('status', ['active', 'pending'])
            ->values()
            ->makeHidden(['gateway_token', 'gateway_ref']);

        return $this->ok($methods);
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
            // field) is not an origin outage. It must surface as a 422 with
            // honest copy — never a raw 502, which Cloudflare swaps for its own
            // branded page (hiding the real reason). The detailed reason is
            // already logged in PaymentService; expose it only in debug meta.
            return $this->fail(
                ErrorCode::PAYMENT_GATEWAY_ERROR,
                'We couldn’t start linking that account right now. You weren’t charged — please try again in a moment.',
                meta: config('app.debug') ? ['debug' => $e->reason()] : [],
            );
        } catch (\Throwable $e) {
            // Genuinely unexpected failure (not a gateway rejection). Report it
            // and return the standardized 500 envelope (NOT a 502 — Cloudflare
            // masks 5xx gateway codes and swallows our JSON).
            report($e);

            return $this->fail(ErrorCode::SERVER_ERROR, 'We couldn’t start linking that account right now. Please try again in a moment.');
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

        return $this->created($method->makeHidden(['gateway_token', 'gateway_ref']), merge: [
            // The app opens this to authorize the link; null if already active.
            'action_url' => PaymentService::extractActionUrl($pm),
        ]);
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

        return $this->created($method->makeHidden(['gateway_token']));
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $method = PaymentMethod::where('user_id', $request->user()->id)
            ->findOrFail($id);

        $wasDefault = $method->is_default;
        $method->delete();

        if ($wasDefault) {
            // Promote only a usable method — index() hides expired/failed ones,
            // so promoting one would leave no VISIBLE default.
            PaymentMethod::where('user_id', $request->user()->id)
                ->whereIn('status', ['active', 'pending'])
                ->orderBy('created_at')
                ->first()
                ?->update(['is_default' => true]);
        }

        return $this->ok(null, 'Payment method removed.');
    }

    public function setDefault(Request $request, string $id): JsonResponse
    {
        $user = $request->user();

        // Verify the target exists (and belongs to the user) BEFORE clearing the
        // current default. Otherwise a stale client setting a since-deleted
        // method wipes every is_default flag, matches 0 rows on the set, and
        // still returns 200 — leaving the user with valid methods but no default.
        // Mirrors destroy()'s findOrFail (404 on a gone method).
        $method = PaymentMethod::where('user_id', $user->id)->findOrFail($id);

        PaymentMethod::where('user_id', $user->id)->update(['is_default' => false]);
        $method->update(['is_default' => true]);

        return $this->ok(null, 'Default payment method updated.');
    }
}
