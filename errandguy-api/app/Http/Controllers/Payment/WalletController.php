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
            );
        } catch (\Throwable $e) {
            // The gateway rejected the request (e.g. API key lacks Invoice
            // permission) or was unreachable. The real reason is already
            // logged by WalletService/PaymentService; surface a clean,
            // actionable message instead of a raw 500 "Server Error".
            return response()->json([
                'message' => 'We couldn’t start your payment right now. Please try again in a moment.',
            ], 502);
        }

        return response()->json([
            'data' => $result['transaction'],
            // Client must open this URL to actually pay; the wallet is
            // credited only after Xendit confirms via webhook.
            'checkout_url' => $result['checkout_url'],
        ], 201);
    }

    public function transactions(Request $request): JsonResponse
    {
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

        $transactions = $query->paginate($request->integer('per_page', 20));

        return response()->json($transactions);
    }
}
