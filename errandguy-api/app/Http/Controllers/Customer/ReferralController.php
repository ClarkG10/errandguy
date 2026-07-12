<?php

namespace App\Http\Controllers\Customer;

use App\Http\Controllers\Controller;
use App\Http\Requests\Customer\ApplyReferralRequest;
use App\Models\Referral;
use App\Services\ReferralService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ReferralController extends Controller
{
    public function __construct(
        private ReferralService $referralService,
    ) {}

    /**
     * GET /user/referral — the caller's own referral code, a shareable
     * link, per-status counts of people they've referred, and total
     * bonus earned from rewarded referrals.
     */
    public function show(Request $request): JsonResponse
    {
        $user = $request->user();

        // Backfill a code for legacy accounts created before the program.
        if (!$user->referral_code) {
            $user->update(['referral_code' => $this->referralService->generateCode()]);
        }

        $counts = Referral::where('referrer_id', $user->id)
            ->selectRaw('status, count(*) as aggregate')
            ->groupBy('status')
            ->pluck('aggregate', 'status');

        $totalEarned = (float) Referral::where('referrer_id', $user->id)
            ->where('status', 'rewarded')
            ->sum('reward_amount');

        return response()->json([
            'data' => [
                'referral_code' => $user->referral_code,
                'share_link' => rtrim(config('app.url'), '/') . '/r/' . $user->referral_code,
                'counts' => [
                    'pending' => (int) ($counts['pending'] ?? 0),
                    'qualified' => (int) ($counts['qualified'] ?? 0),
                    'rewarded' => (int) ($counts['rewarded'] ?? 0),
                ],
                'total_earned' => $totalEarned,
            ],
        ]);
    }

    /**
     * POST /user/referral/apply — redeem someone else's referral code.
     */
    public function apply(ApplyReferralRequest $request): JsonResponse
    {
        $user = $request->user();

        try {
            $referral = $this->referralService->attach(
                $user->id,
                $request->validated()['code'],
            );
        } catch (\RuntimeException $e) {
            $message = match ($e->getMessage()) {
                'invalid_code' => 'That referral code is not valid.',
                'self_referral' => 'You cannot use your own referral code.',
                'already_referred' => 'You have already used a referral code.',
                default => 'Could not apply referral code.',
            };

            return response()->json(['message' => $message], 422);
        }

        return response()->json([
            'data' => new \App\Http\Resources\ReferralResource($referral),
            'message' => 'Referral code applied. You and your friend will earn a reward once you complete your first errand.',
        ], 201);
    }
}
