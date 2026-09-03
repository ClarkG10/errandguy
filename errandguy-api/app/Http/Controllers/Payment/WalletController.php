<?php

namespace App\Http\Controllers\Payment;

use App\Http\Controllers\Controller;
use App\Models\WalletTransaction;
use App\Services\PaymentService;
use App\Services\WalletService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

class WalletController extends Controller
{
    /**
     * Minimum seconds between synchronous gateway pulls for the SAME top-up
     * during status polling. Mirrors PaymentService's booking-charge throttle:
     * the app polls every ~3s and each pull is a blocking Xendit GET that
     * occupies an FPM worker, while the webhook stays the primary real-time
     * settlement path — so pulling at most once per window loses no freshness.
     */
    private const RECONCILE_PULL_THROTTLE_SECONDS = 10;

    public function __construct(
        private WalletService $walletService,
    ) {}

    public function balance(Request $request): JsonResponse
    {
        $balance = $this->walletService->getBalance($request->user()->id);

        return $this->ok(['balance' => $balance]);
    }

    public function topUp(Request $request): JsonResponse
    {
        $user = $request->user();

        $validated = $request->validate([
            'amount' => ['required', 'numeric', 'min:50', 'max:50000'],
            // Optional in-app method choice. GCash/Maya → a direct charge that
            // deep-links into the wallet app (no hosted page); card or omitted →
            // the Xendit hosted invoice (unchanged; card entry stays in Xendit).
            'method' => ['nullable', 'string', \Illuminate\Validation\Rule::in(['gcash', 'maya', 'card'])],
            // Optional: the Xendit hosted invoice lets the customer choose
            // GCash / Maya / card at checkout, so a saved method isn't
            // required. When supplied it must still belong to the caller.
            'payment_method_id' => [
                'nullable',
                'string',
                \Illuminate\Validation\Rule::exists('payment_methods', 'id')
                    ->where(fn ($q) => $q->where('user_id', $user->id)),
            ],
        ], [
            'payment_method_id.exists' => 'Selected payment method is not available on your account.',
            'amount.min' => 'The minimum top-up is ₱50. Please enter ₱50 or more.',
            'amount.max' => 'The maximum top-up is ₱50,000. Please enter a smaller amount.',
        ]);

        // Idempotency guard: reuse an existing PENDING top-up of the same
        // amount created in the last 60s (network retry / double-tap) rather
        // than opening a second invoice.
        //
        // ONLY when no explicit method was chosen. With a method, the stored
        // checkout_url is channel-specific (a GCash/Maya deep-link vs an invoice
        // page), so reusing a same-amount pending row would hand back the wrong
        // channel's URL on a method switch. Method-specific double-taps are
        // already deduped by the `idempotent` middleware (same Idempotency-Key)
        // and the client submit-latch; and since only the charge the customer
        // actually authorizes ever settles, an extra abandoned pending row is
        // money-safe (completeTopUp credits exactly once, per charge).
        if (empty($validated['method'])) {
            $duplicate = WalletTransaction::where('user_id', $user->id)
                ->where('type', 'top_up')
                ->where('status', 'pending')
                ->where('amount', $validated['amount'])
                ->where('created_at', '>=', now()->subSeconds(60))
                ->whereNotNull('checkout_url')
                ->latest('created_at')
                ->first();

            if ($duplicate) {
                return $this->ok($duplicate, merge: [
                    'checkout_url' => $duplicate->checkout_url,
                    'idempotent' => true,
                ]);
            }
        }

        // A gateway rejection throws PaymentGatewayException, which
        // ApiExceptionRenderer renders as a clean 422 with honest "you weren’t
        // charged" copy — NEVER a Cloudflare-masked 502. Any other failure
        // becomes the standardized 500 envelope. The real gateway reason is
        // logged by WalletService and echoed into the error envelope's
        // meta.debug when APP_DEBUG is on.
        $result = $this->walletService->initiateTopUp(
            $user->id,
            (float) $validated['amount'],
            $user->email,
            // After paying, Xendit redirects here; the bridge page forwards
            // to the app deep link so the in-app checkout sheet auto-closes.
            url('/payment/complete'),
            $validated['method'] ?? null,
            // Failure return carries ?status=failed so the bridge shows
            // honest copy instead of a green "Payment received".
            url('/payment/complete?status=failed'),
        );

        return $this->created($result['transaction'], merge: [
            // Client must open this URL to actually pay; the wallet is
            // credited only after Xendit confirms via webhook.
            'checkout_url' => $result['checkout_url'],
        ]);
    }

    /**
     * Authoritative status probe for a single wallet transaction (used by the
     * app to VERIFY a top-up after checkout). Ownership scoped by user_id.
     */
    public function transactionStatus(Request $request, string $id): JsonResponse
    {
        $tx = WalletTransaction::where('user_id', $request->user()->id)->findOrFail($id);

        // Confirm settlement directly with the gateway so a delayed/undelivered
        // webhook (or local dev, where webhooks can't reach us) never leaves a
        // genuinely-paid top-up stuck 'pending'. Same pull-reconcile the booking
        // charge already gets in PaymentStatusController::show.
        $tx = $this->reconcilePendingTopUp($tx);

        // Terminal non-success states. WalletTransaction only ever emits
        // 'failed' today (an expired top-up is coerced to 'failed'), but the
        // guard is widened so failure_reason stays correct if the enum grows.
        $failureStates = ['failed', 'expired', 'cancelled', 'refunded'];
        $processedAt = optional($tx->processed_at)->toIso8601String();

        return $this->ok([
            // Canonical contract shared with PaymentStatusController.
            'kind' => 'wallet_topup',
            'id' => $tx->id,
            'transaction_id' => $tx->id, // alias kept for existing clients
            'status' => $tx->status,
            'type' => $tx->type,
            'amount' => (float) $tx->amount,
            'balance_after' => (float) $tx->balance_after,
            'settled_at' => $processedAt,
            'processed_at' => $processedAt, // alias kept for existing clients
            'failure_reason' => in_array($tx->status, $failureStates, true) ? $tx->failure_reason : null,
        ]);
    }

    /**
     * Pull-based settlement reconciliation for a PENDING wallet top-up.
     *
     * Top-up was the one money-in flow with no pull path: the booking probe
     * asks Xendit when a webhook lags, but this endpoint only re-read the DB
     * row. So a delayed or dropped webhook left a customer whose money had
     * already left GCash on "Payment is being processed" forever — and they
     * usually started a second top-up.
     *
     * Deliberately narrow and additive:
     *   • no-op unless this is a pending top_up with a gateway ref;
     *   • throttled per-transaction (see RECONCILE_PULL_THROTTLE_SECONDS) so a
     *     3s poll can't hammer the gateway or drain the FPM pool;
     *   • settles ONLY through WalletService::completeTopUp / expireTopUp —
     *     both row-locked, idempotent, and carrying their own settled-in-full
     *     guard — so this cannot credit twice or credit an under-settled charge;
     *   • only ever moves the row to the state the gateway itself reports;
     *   • a gateway hiccup NEVER fails the poll (stays pending, retries next).
     */
    private function reconcilePendingTopUp(WalletTransaction $tx): WalletTransaction
    {
        if ($tx->type !== 'top_up' || $tx->status !== 'pending' || blank($tx->gateway_ref)) {
            return $tx;
        }

        // Only the DIRECT e-wallet charge (GCash/Maya) can be pulled today: its
        // gateway_ref is a Payment Requests id ("pr-…"), which PaymentService
        // already knows how to GET. A hosted card invoice's id would need a
        // /v2/invoices/{id} read that PaymentService doesn't expose, so those
        // stay webhook-only (unchanged behaviour, never a wrong answer).
        //
        // The prefix is a safe discriminator, not a guess: an invoice id is a
        // hex ObjectId, which cannot begin with "pr". If Xendit ever renamed
        // the prefix this would simply stop pulling and fall back to today's
        // webhook-only behaviour — it can never mis-address a lookup.
        if (! str_starts_with((string) $tx->gateway_ref, 'pr')) {
            return $tx;
        }

        // Cache::add is the throttle latch — it succeeds only when the key is
        // absent, so exactly one poll per window wins the pull and the rest
        // return the current DB state (kept live by the webhook).
        if (! Cache::add("topup_reconcile_pull:{$tx->id}", 1, self::RECONCILE_PULL_THROTTLE_SECONDS)) {
            return $tx;
        }

        try {
            $pr = app(PaymentService::class)->getPaymentRequest((string) $tx->gateway_ref);
        } catch (\Throwable $e) {
            // Gateway unreachable / not configured / transient — never fail the
            // poll; the webhook is still the primary settlement path.
            return $tx;
        }

        $gatewayStatus = strtoupper((string) ($pr['status'] ?? ''));

        try {
            // PENDING / REQUIRES_ACTION → the customer hasn't finished paying.
            $settled = match ($gatewayStatus) {
                'SUCCEEDED' => $this->walletService->completeTopUp($tx->id, $pr),
                'FAILED' => $this->walletService->expireTopUp($tx->id, 'Payment failed'),
                'EXPIRED' => $this->walletService->expireTopUp($tx->id, 'Payment window expired'),
                default => null,
            };
        } catch (\Throwable $e) {
            // A settlement error must never 500 a status poll.
            Log::warning('Xendit top-up reconcile failed', [
                'transaction_id' => $tx->id,
                'error' => $e->getMessage(),
            ]);

            return $tx->fresh() ?? $tx;
        }

        return $settled ?? $tx;
    }

    public function transactions(Request $request): JsonResponse
    {
        // date_from/date_to are fed to Carbon::parse below, which throws an
        // uncaught 500 on garbage input — validate first.
        $request->validate([
            'type' => ['nullable', 'string', 'max:30'],
            'date_from' => ['nullable', 'date'],
            'date_to' => ['nullable', 'date'],
        ]);

        // Eager-load the booking + errand type so the appended
        // `display_description` accessor on each row can compose a
        // friendly label without triggering an N+1 lookup per row.
        $query = WalletTransaction::with(['booking:id,booking_number,errand_type_id', 'booking.errandType:id,name'])
            ->where('user_id', $request->user()->id)
            ->orderByDesc('created_at');

        if ($request->filled('type')) {
            $query->where('type', $request->input('type'));
        }

        // A gateway-funded tip records a 'tip_payment' row on the CUSTOMER purely
        // to carry the Xendit charge lifecycle — the money is paid online
        // straight to the runner and never moves the customer's wallet balance.
        // Showing it in the ledger would render a debit against an unchanged
        // running balance, so it's hidden unless explicitly requested. (The
        // runner's real 'tip' credit is a genuine wallet movement and still
        // shows.)
        if ($request->input('type') !== 'tip_payment') {
            $query->where('type', '!=', 'tip_payment');
        }

        if ($request->filled('date_from')) {
            $query->where('created_at', '>=', \Carbon\Carbon::parse($request->input('date_from'))->startOfDay());
        }

        if ($request->filled('date_to')) {
            $query->where('created_at', '<=', \Carbon\Carbon::parse($request->input('date_to'))->endOfDay());
        }

        $transactions = $query->paginate($request->perPage(20));

        // The canonical nested-meta envelope ({data, links, meta}) is now
        // produced by the shared ApiResponse::paginated() helper (previously
        // this block was copy-pasted per list endpoint). Rows stay the same raw
        // WalletTransaction models the mobile client reads at .data.data.
        return $this->paginated($transactions);
    }
}
