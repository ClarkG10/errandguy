<?php

namespace App\Http\Controllers\Payment;

use App\Http\Controllers\Controller;
use App\Models\WalletTransaction;
use App\Services\WalletService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class WalletController extends Controller
{
    public function __construct(
        private WalletService $walletService,
    ) {}

    public function balance(Request $request): JsonResponse
    {
        $balance = $this->walletService->getBalance($request->user()->id);

        return response()->json([
            'data' => ['balance' => $balance],
        ]);
    }

    public function topUp(Request $request): JsonResponse
    {
        $user = $request->user();

        $validated = $request->validate([
            'amount' => ['required', 'numeric', 'min:50', 'max:50000'],
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
        ]);

        // Idempotency guard: reuse an existing PENDING top-up of the same
        // amount created in the last 60s (network retry / double-tap) rather
        // than opening a second invoice.
        $duplicate = WalletTransaction::where('user_id', $user->id)
            ->where('type', 'top_up')
            ->where('status', 'pending')
            ->where('amount', $validated['amount'])
            ->where('created_at', '>=', now()->subSeconds(60))
            ->whereNotNull('checkout_url')
            ->latest('created_at')
            ->first();

        if ($duplicate) {
            return response()->json([
                'data' => $duplicate,
                'checkout_url' => $duplicate->checkout_url,
                'idempotent' => true,
            ], 200);
        }

        try {
            $result = $this->walletService->initiateTopUp(
                $user->id,
                (float) $validated['amount'],
                $user->email,
                // After paying, Xendit redirects here; the bridge page forwards
                // to the app deep link so the in-app checkout sheet auto-closes.
                url('/payment/complete'),
            );
        } catch (\Throwable $e) {
            // The gateway rejected the request (e.g. API key lacks Invoice
            // permission) or was unreachable. The real reason is always logged
            // by WalletService/PaymentService. In debug mode we also put the
            // gateway's own reason in the message so it's visible in the app —
            // production users just get the friendly line.
            $message = 'We couldn’t start your payment right now. Please try again in a moment.';
            if (config('app.debug') && $e instanceof \App\Exceptions\PaymentGatewayException) {
                $message = "Payment gateway error: {$e->reason()}";
            }

            return response()->json(['message' => $message], 502);
        }

        return response()->json([
            'data' => $result['transaction'],
            // Client must open this URL to actually pay; the wallet is
            // credited only after Xendit confirms via webhook.
            'checkout_url' => $result['checkout_url'],
        ], 201);
    }

    /**
     * Authoritative status probe for a single wallet transaction (used by the
     * app to VERIFY a top-up after checkout). Ownership scoped by user_id.
     */
    public function transactionStatus(Request $request, string $id): JsonResponse
    {
        $tx = WalletTransaction::where('user_id', $request->user()->id)->findOrFail($id);

        // Terminal non-success states. WalletTransaction only ever emits
        // 'failed' today (an expired top-up is coerced to 'failed'), but the
        // guard is widened so failure_reason stays correct if the enum grows.
        $failureStates = ['failed', 'expired', 'cancelled', 'refunded'];
        $processedAt = optional($tx->processed_at)->toIso8601String();

        return response()->json([
            'data' => [
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
            ],
        ]);
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

        if ($request->filled('date_from')) {
            $query->where('created_at', '>=', \Carbon\Carbon::parse($request->input('date_from'))->startOfDay());
        }

        if ($request->filled('date_to')) {
            $query->where('created_at', '<=', \Carbon\Carbon::parse($request->input('date_to'))->endOfDay());
        }

        $transactions = $query->paginate($request->perPage(20));

        // Emit the canonical nested-meta envelope ({data, links, meta}) that
        // every other paginated list endpoint uses, instead of the raw flat
        // LengthAwarePaginator (which serialized pagination at the top level
        // and leaked absolute server URLs). Rows are still the same raw
        // WalletTransaction models — the mobile client reads them at .data.data
        // in both shapes, so this is backward compatible.
        return response()->json([
            'data' => $transactions->items(),
            'links' => [
                'first' => $transactions->url(1),
                'last' => $transactions->url($transactions->lastPage()),
                'prev' => $transactions->previousPageUrl(),
                'next' => $transactions->nextPageUrl(),
            ],
            'meta' => [
                'current_page' => $transactions->currentPage(),
                'from' => $transactions->firstItem(),
                'last_page' => $transactions->lastPage(),
                'path' => $transactions->path(),
                'per_page' => $transactions->perPage(),
                'to' => $transactions->lastItem(),
                'total' => $transactions->total(),
            ],
        ]);
    }
}
