<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Models\WalletTransaction;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Admin-side payout reconciliation.
 *
 * The runner-facing flow only debits the wallet and writes a `payout`
 * row with status='pending'. Admins use this controller to mark each
 * payout completed once funds have been disbursed to the runner's
 * bank/e-wallet — or to mark it failed and refund the wallet so the
 * runner isn't out of pocket on a bounce.
 */
class AdminPayoutController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $query = WalletTransaction::with('user:id,full_name,phone')
            ->where('type', 'payout')
            ->orderByDesc('created_at');

        if ($request->filled('status')) {
            $query->where('status', $request->input('status'));
        }

        return response()->json(
            $query->paginate($request->integer('per_page', 25))
        );
    }

    public function markCompleted(Request $request, string $id): JsonResponse
    {
        $tx = WalletTransaction::where('type', 'payout')->findOrFail($id);

        if ($tx->status !== 'pending') {
            return response()->json([
                'message' => 'Only pending payouts can be marked completed.',
            ], 422);
        }

        $tx->update([
            'status' => 'completed',
            'processed_at' => now(),
        ]);

        return response()->json(['data' => $tx]);
    }

    public function markFailed(Request $request, string $id): JsonResponse
    {
        $validated = $request->validate([
            'reason' => ['required', 'string', 'max:500'],
        ]);

        // Refund + status update must be atomic so we don't leave the
        // runner double-debited if the refund half fails.
        $tx = DB::transaction(function () use ($id, $validated) {
            $tx = WalletTransaction::where('type', 'payout')
                ->lockForUpdate()
                ->findOrFail($id);

            if ($tx->status !== 'pending') {
                throw new \RuntimeException('only_pending');
            }

            $user = User::lockForUpdate()->findOrFail($tx->user_id);
            // Re-credit the wallet using the same absolute amount that
            // was debited when the payout was requested.
            $refundAmount = abs((float) $tx->amount);
            $newBalance = (float) $user->wallet_balance + $refundAmount;

            // Audit-trail row so the refund is visible to the runner
            // ("ErrandGuy · Refund for failed payout").
            WalletTransaction::create([
                'user_id' => $user->id,
                'type' => 'refund',
                'amount' => $refundAmount,
                'balance_after' => $newBalance,
                'reference_id' => $tx->id,
                'description' => 'Refund for failed payout',
                'status' => 'completed',
                'processed_at' => now(),
            ]);

            $user->update(['wallet_balance' => $newBalance]);

            $tx->update([
                'status' => 'failed',
                'processed_at' => now(),
                'failure_reason' => $validated['reason'],
            ]);

            return $tx->fresh();
        });

        return response()->json(['data' => $tx]);
    }
}
