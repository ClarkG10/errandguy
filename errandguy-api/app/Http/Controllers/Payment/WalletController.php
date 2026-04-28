<?php

namespace App\Http\Controllers\Payment;

use App\Http\Controllers\Controller;
use App\Models\WalletTransaction;
use App\Services\PaymentService;
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
            'payment_method_id' => [
                'required',
                'string',
                // SECURITY: scope payment_method_id to the requesting user
                // so an attacker can't reference someone else's saved
                // payment method (or trigger the top-up with a method
                // that has been deleted).
                \Illuminate\Validation\Rule::exists('payment_methods', 'id')
                    ->where(fn ($q) => $q->where('user_id', $user->id)),
            ],
        ], [
            'payment_method_id.exists' => 'Selected payment method is not available on your account.',
        ]);

        $transaction = $this->walletService->topUp(
            $user->id,
            (float) $validated['amount'],
            $validated['payment_method_id']
        );

        return response()->json([
            'data' => $transaction,
        ], 201);
    }

    public function transactions(Request $request): JsonResponse
    {
        $query = WalletTransaction::where('user_id', $request->user()->id)
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
