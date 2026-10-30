<?php

namespace App\Http\Controllers\Runner;

use App\Exceptions\WithdrawalException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Runner\PayoutRequest;
use App\Http\Resources\RunnerProfileResource;
use App\Models\RunnerProfile;
use App\Services\WalletService;
use App\Support\ErrorCode;
use App\Support\PayoutDestination;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class RunnerPayoutController extends Controller
{
    public function requestPayout(PayoutRequest $request): JsonResponse
    {
        $user = $request->user();
        $profile = $user->runnerProfile;

        if (!$profile) {
            return $this->fail(ErrorCode::NOT_FOUND, 'We couldn’t find your runner profile. Please contact support.', 404);
        }

        // A payout needs somewhere to go: an e-wallet number, or a bank with
        // BOTH its name and an account number. Rejected here, where the
        // message can say exactly what is missing, rather than leaving an
        // unsendable payout in the admin queue.
        $destination = $profile->payoutDestination($user->full_name);

        if ($destination === null) {
            return $this->fail(
                ErrorCode::PAYOUT_METHOD_REQUIRED,
                filled($profile->bank_name) && $profile->payout_channel !== 'gcash' && $profile->payout_channel !== 'maya'
                    ? 'Your '.$profile->bank_name.' payout details are incomplete — add your account number in '
                        .'payout settings before requesting a payout.'
                    : 'Add a bank account or e-wallet in your payout settings before requesting a payout.',
            );
        }

        $amount = (float) $request->validated('amount');

        try {
            // The Idempotency-Key (guaranteed present by `idempotent:required`)
            // becomes the payout's stable reference_id, so the (user_id,
            // reference_id, type) unique index is a hard DB backstop against a
            // double-debit even if the HTTP idempotency layer is bypassed.
            $transaction = app(WalletService::class)->createPendingPayout(
                $user->id,
                $amount,
                (string) $request->header('Idempotency-Key'),
                $destination,
                WalletService::runnerPayoutMinimum(),
                'Payout request',
            );
        } catch (WithdrawalException $e) {
            return $this->fail($e->errorCode, $e->getMessage());
        }

        // Name the destination the money will ACTUALLY go to — the one now
        // recorded on the payout, which is what staff send to.
        return $this->ok(
            $transaction,
            'Payout of ₱'.number_format($amount, 2).' to '.PayoutDestination::label($destination).' requested. '
                .'It’s being reviewed and usually arrives within 1–3 business days — we’ll notify you the moment it’s sent.',
        );
    }

    /**
     * PUT /runner/payout-method — save where payouts go: GCash, Maya or a bank
     * account, with the account number and the account holder's name.
     *
     * Saving one channel clears the other's number, so a runner has exactly
     * ONE payout method and staff can never send to the "wrong" saved number.
     */
    public function saveMethod(Request $request): JsonResponse
    {
        $validated = $request->validate(
            PayoutDestination::rules($request->input('channel')),
            PayoutDestination::messages(),
        );

        $profile = $this->profileFor($request);
        $destination = PayoutDestination::fromInput($validated);
        $isBank = $destination['channel'] === 'bank';

        $profile->update([
            'payout_channel' => $destination['channel'],
            'payout_account_name' => $destination['account_name'],
            'ewallet_number' => $isBank ? null : $destination['account_number'],
            'bank_name' => $isBank ? $destination['bank_name'] : null,
            'bank_account_number' => $isBank ? $destination['account_number'] : null,
            'payout_channel_code' => $destination['channel_code'],
        ]);

        return $this->ok(
            new RunnerProfileResource($profile->fresh()->load('documents')),
            'Payout method saved: '.PayoutDestination::label($destination).'.',
        );
    }

    /**
     * DELETE /runner/payout-method — remove the saved payout method. Payouts
     * already requested keep the destination they were requested with.
     */
    public function removeMethod(Request $request): JsonResponse
    {
        $profile = $this->profileFor($request);

        $profile->update([
            'payout_channel' => null,
            'payout_account_name' => null,
            'ewallet_number' => null,
            'bank_name' => null,
            'bank_account_number' => null,
            'payout_channel_code' => null,
        ]);

        return $this->ok(
            new RunnerProfileResource($profile->fresh()->load('documents')),
            'Payout method removed.',
        );
    }

    private function profileFor(Request $request): RunnerProfile
    {
        return $request->user()->runnerProfile
            ?? RunnerProfile::create(['user_id' => $request->user()->id, 'verification_status' => 'pending']);
    }
}
