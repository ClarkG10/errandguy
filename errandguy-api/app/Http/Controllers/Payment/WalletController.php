<?php

namespace App\Http\Controllers\Payment;

use App\Exceptions\WithdrawalException;
use App\Http\Controllers\Controller;
use App\Models\WalletTransaction;
use App\Services\WalletService;
use App\Support\PayoutDestination;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class WalletController extends Controller
{
    /**
     * Most pending payouts reconciled on a single wallet-list read.
     *
     * Each one is a blocking gateway GET on a user-facing endpoint, so this
     * bounds worst-case latency. A runner realistically has one pending payout;
     * the scheduled sweep covers any beyond the cap.
     */
    private const MAX_PAYOUT_RECONCILES_PER_READ = 3;

    public function __construct(
        private WalletService $walletService,
    ) {}

    public function balance(Request $request): JsonResponse
    {
        $user = $request->user();
        $balance = $this->walletService->getBalance($user->id);

        return $this->ok([
            // The withdrawable wallet balance (negative for a runner who owes
            // money from cash errands). Unchanged — every client reads it.
            'balance' => $balance,
            // Additive: what can actually be withdrawn (never below zero), and
            // the non-withdrawable promotional credit from the retired referral
            // program, which is still spent first on errands until used up.
            'withdrawable' => max(0.0, round($balance, 2)),
            'bonus_balance' => round((float) $user->bonus_balance, 2),
        ]);
    }

    /**
     * POST /wallet/withdraw — a customer withdraws their wallet balance to
     * GCash or Maya.
     *
     * The same pending-then-staff-sends flow a runner's payout uses
     * (WalletService::createPendingPayout): the withdrawable balance is debited
     * now and the payout waits in the admin Payouts queue for "Send via
     * Xendit"; the customer is told when it is sent, or if it bounces (the
     * money then comes back). Only the withdrawable balance can go — bonus
     * credit never. No minimum for customers; an account with a runner
     * profile keeps the runner minimum, so switching mode can't dodge it.
     *
     * `idempotent:required` + the Idempotency-Key as the payout's reference
     * make a double-tap or retry return the first withdrawal, never a second.
     */
    public function withdraw(Request $request): JsonResponse
    {
        $user = $request->user();

        $validated = $request->validate([
            'amount' => ['required', 'numeric', 'min:1', 'max:1000000'],
            ...PayoutDestination::rules($request->input('channel'), allowBank: false),
        ], [
            'amount.min' => 'Enter at least ₱1.00 to withdraw.',
            ...PayoutDestination::messages(allowBank: false),
        ]);

        $destination = PayoutDestination::fromInput($validated);

        try {
            $transaction = $this->walletService->createPendingPayout(
                $user->id,
                (float) $validated['amount'],
                (string) $request->header('Idempotency-Key'),
                $destination,
                $user->runnerProfile ? WalletService::runnerPayoutMinimum() : 0.0,
                'Withdrawal request',
            );
        } catch (WithdrawalException $e) {
            return $this->fail($e->errorCode, $e->getMessage());
        }

        return $this->created(
            $transaction,
            'Withdrawal of ₱'.number_format(abs((float) $transaction->amount), 2).' to '
                .PayoutDestination::label($destination).' requested. It usually arrives within 1–3 business days '
                .'— we’ll notify you the moment it’s sent.',
        );
    }

    /**
     * Authoritative status probe for a single wallet transaction (used by the
     * app to VERIFY a GCash/Maya tip charge after checkout, and a legacy
     * top-up started before top-ups were retired). Ownership scoped by user_id.
     */
    public function transactionStatus(Request $request, string $id): JsonResponse
    {
        $tx = WalletTransaction::where('user_id', $request->user()->id)->findOrFail($id);

        // Confirm settlement directly with the gateway so a delayed/undelivered
        // webhook (or local dev, where webhooks can't reach us) never leaves a
        // genuinely-paid charge stuck 'pending'. Same pull-reconcile the booking
        // charge already gets in PaymentStatusController::show.
        //
        // The implementation lives in WalletService because the scheduled sweep
        // (errandguy:reconcile-topups) needs the identical logic for the case
        // this endpoint can't cover: a customer who paid and never came back.
        // ('kind' stays 'wallet_topup' for the app build already on phones.)
        $tx = $this->walletService->reconcilePendingTopUp($tx);

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

        // Heal stranded payouts on the very read the runner performs to check on
        // them. The runner's payout screen loads this endpoint with
        // ?type=payout, so opening it is the strongest possible signal that
        // someone is waiting on that money — and a payout whose webhook never
        // arrived is otherwise invisible to everything: the wallet is already
        // debited, the row sits `pending` forever, and the app keeps showing
        // "View payout status" instead of letting them request another.
        //
        // Deliberately on the READ rather than only in a sweep: the scheduled
        // sweep is the backstop for nobody looking, but this path costs one
        // throttled gateway GET and works even when the scheduler is down.
        // Per-transaction throttled, and settlement goes through the same
        // row-locked, pending-guarded methods the webhook uses.
        // Bounded: each reconcile is a BLOCKING gateway GET, so a page carrying
        // many pending payouts must not turn one list request into twenty round
        // trips. Newest-first ordering means the cap keeps the rows a runner is
        // actually watching; anything older is picked up by the sweep.
        $budget = self::MAX_PAYOUT_RECONCILES_PER_READ;
        $transactions->setCollection(
            $transactions->getCollection()->map(function (WalletTransaction $row) use (&$budget) {
                if ($budget <= 0 || $row->type !== 'payout' || $row->status !== 'pending') {
                    return $row;
                }
                $budget--;

                // Return the SETTLED row so the response reflects the state we
                // just wrote — otherwise the runner is shown 'pending' anyway
                // and has to pull-to-refresh to see money that already landed.
                return $this->walletService->reconcilePendingPayout($row);
            })
        );

        // The canonical nested-meta envelope ({data, links, meta}) is now
        // produced by the shared ApiResponse::paginated() helper (previously
        // this block was copy-pasted per list endpoint). Rows stay the same raw
        // WalletTransaction models the mobile client reads at .data.data.
        return $this->paginated($transactions);
    }
}
