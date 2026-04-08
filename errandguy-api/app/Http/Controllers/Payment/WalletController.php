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
        $validated = $request->validate([
            'amount' => ['required', 'numeric', 'min:50', 'max:50000'],
            'payment_method_id' => ['required', 'string', 'exists:payment_methods,id'],
        ]);

        $user = $request->user();

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
            $query->whereDate('created_at', '>=', $request->input('date_from'));
        }

        if ($request->filled('date_to')) {
            $query->whereDate('created_at', '<=', $request->input('date_to'));
        }

        $transactions = $query->paginate($request->integer('per_page', 20));

        return response()->json($transactions);
    }
}
