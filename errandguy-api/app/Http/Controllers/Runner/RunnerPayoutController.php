<?php

namespace App\Http\Controllers\Runner;

use App\Http\Controllers\Controller;
use App\Http\Requests\Runner\PayoutRequest;
use App\Models\SystemConfig;
use App\Models\User;
use App\Models\WalletTransaction;
use App\Support\ErrorCode;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

class RunnerPayoutController extends Controller
{
    public function requestPayout(PayoutRequest $request): JsonResponse
    {
        $user = $request->user();
        $profile = $user->runnerProfile;

        if (!$profile) {
            return $this->fail(ErrorCode::NOT_FOUND, 'We couldn’t find your runner profile. Please contact support.', 404);
        }

        // Check payout method is configured. An e-wallet number alone is
        // sendable; a bank needs BOTH the bank name and an account number, so
        // "bank_name is set" was too loose — a runner who filled only the bank
        // name passed this gate, got a hopeful "arrives in 1–3 days" receipt,
        // and their payout then sat unsendable in the admin queue (the bulk
        // disburse skips rows with no saved account). Reject it here, where the
        // message can say exactly what is missing. Reads the RAW column so a
        // legacy/undecryptable value still counts as on file.
        $hasEwallet = filled($profile->ewallet_number);
        $hasBank = filled($profile->bank_name) && $profile->hasStoredBankAccountNumber();

        if (!$hasEwallet && !$hasBank) {
            return $this->fail(
                ErrorCode::PAYOUT_METHOD_REQUIRED,
                filled($profile->bank_name)
                    ? 'Your '.$profile->bank_name.' payout details are incomplete — add your account number in '
                        .'payout settings before requesting a payout.'
                    : 'Add a bank account or e-wallet in your payout settings before requesting a payout.',
            );
        }

        $amount = (float) $request->validated('amount');
        $minPayout = (float) SystemConfig::getValue('min_payout_amount', '100');

        if ($amount < $minPayout) {
            return $this->fail(
                ErrorCode::PAYOUT_MIN_AMOUNT,
                'The minimum payout is ₱'.number_format($minPayout, 2).'. Please request at least that amount.',
            );
        }

        // The Idempotency-Key (guaranteed present by `idempotent:required`)
        // becomes the payout's stable reference_id. That turns the partial
        // unique index (user_id, reference_id, type) into a hard DB backstop
        // against a double-debit even if the HTTP idempotency layer is ever
        // bypassed (e.g. the other backend) — payouts previously carried a
        // NULL reference and were excluded from that guard entirely (P0-8).
        $reference = (string) $request->header('Idempotency-Key');

        // Atomic balance check + debit. Re-reading the balance INSIDE the
        // transaction with lockForUpdate prevents two concurrent payout
        // requests from both passing a stale balance check and draining
        // the wallet below zero.
        try {
            $transaction = DB::transaction(function () use ($user, $amount, $reference) {
                $locked = User::whereKey($user->id)->lockForUpdate()->firstOrFail();

                // Idempotent replay: a payout already exists for this reference
                // → return it instead of debiting a second time.
                $existing = WalletTransaction::where('user_id', $locked->id)
                    ->where('reference_id', $reference)
                    ->where('type', 'payout')
                    ->first();
                if ($existing) {
                    return $existing;
                }

                $balance = (float) $locked->wallet_balance;

                if ($amount > $balance) {
                    throw new \RuntimeException('insufficient');
                }

                // Shared primitive — see WalletService::applyLedgerDelta. The
                // guards above (idempotent reference + sufficient balance) stay
                // here because they are this endpoint's own; only the ledger
                // write itself is shared, so `balance_after` is computed and
                // rounded exactly the way every other money movement is.
                // 'pending' is explicit: a payout is not disbursed until the
                // gateway confirms, and createPayout rejects a non-pending row.
                return app(\App\Services\WalletService::class)->applyLedgerDelta(
                    $locked,
                    'payout',
                    -$amount,
                    $reference,
                    'Payout request',
                    ['status' => 'pending'],
                );
            });
        } catch (\RuntimeException) {
            $balance = number_format((float) $user->fresh()->wallet_balance, 2);

            return $this->fail(
                ErrorCode::INSUFFICIENT_WALLET_BALANCE,
                "You requested ₱".number_format($amount, 2)." but your available balance is ₱{$balance}. Lower the amount and try again.",
            );
        }

        // Name the destination the money will ACTUALLY go to. Both the Filament
        // "Send via Xendit" prefill and the bulk disburse resolve the account as
        // `ewallet_number ?: bank_account_number`, so a runner with both saved
        // was promised "your BPI account" and paid to their e-wallet.
        $destination = $hasEwallet
            ? 'your e-wallet'
            : "your {$profile->bank_name} account";

        return $this->ok(
            $transaction,
            "Payout of ₱".number_format($amount, 2)." to {$destination} requested. It’s being reviewed and usually "
                ."arrives within 1–3 business days — we’ll notify you the moment it’s sent.",
        );
    }
}
