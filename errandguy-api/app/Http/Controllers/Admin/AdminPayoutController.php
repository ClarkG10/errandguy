<?php

namespace App\Http\Controllers\Admin;

use App\Exceptions\PayoutStateException;
use App\Http\Controllers\Controller;
use App\Models\WalletTransaction;
use App\Support\AdminActivity;
use App\Support\ErrorCode;
use App\Services\WalletService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

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
            $query->paginate($request->perPage(25))
        );
    }

    public function markCompleted(Request $request, string $id, WalletService $wallet): JsonResponse
    {
        try {
            $tx = $wallet->completePayout($id);
        } catch (PayoutStateException $e) {
            return $this->fail(ErrorCode::PAYOUT_STATE_INVALID, $e->getMessage());
        }

        AdminActivity::log('payout.completed', $tx, ['payout_id' => $id, 'via' => 'api']);

        return response()->json(['data' => $tx]);
    }

    public function markFailed(Request $request, string $id, WalletService $wallet): JsonResponse
    {
        $validated = $request->validate([
            'reason' => ['required', 'string', 'max:500'],
        ]);

        try {
            $tx = $wallet->failPayout($id, $validated['reason']);
        } catch (PayoutStateException $e) {
            return $this->fail(ErrorCode::PAYOUT_STATE_INVALID, $e->getMessage());
        }

        AdminActivity::log('payout.failed', $tx, ['payout_id' => $id, 'reason' => $validated['reason'], 'via' => 'api']);

        return response()->json(['data' => $tx]);
    }
}
