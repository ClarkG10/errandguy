<?php

namespace App\Http\Controllers\Runner;

use App\Http\Controllers\Controller;
use App\Http\Requests\Runner\UpdateRunnerProfileRequest;
use App\Http\Resources\RunnerProfileResource;
use App\Models\RunnerProfile;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class RunnerProfileController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        $profile = $request->user()->runnerProfile;

        // Auto-create runner profile if the user is a runner but profile is missing
        if (!$profile) {
            $profile = RunnerProfile::create([
                'user_id' => $request->user()->id,
                'verification_status' => 'pending',
            ]);
        }

        $profile->load('documents');

        return response()->json([
            'data' => new RunnerProfileResource($profile),
        ]);
    }

    public function update(UpdateRunnerProfileRequest $request): JsonResponse
    {
        $profile = $request->user()->runnerProfile;

        if (!$profile) {
            $profile = RunnerProfile::create([
                'user_id' => $request->user()->id,
                'verification_status' => 'pending',
            ]);
        }

        $data = $request->validated();

        // The app build already on phones saves payout numbers here without
        // saying which channel they are, so such a save goes back to the
        // original rule (the e-wallet number wins over a bank account). The
        // explicit method lives at PUT /runner/payout-method.
        if (array_intersect_key($data, array_flip(['bank_name', 'bank_account_number', 'ewallet_number'])) !== []
            && $profile->payout_channel !== null) {
            // The channel code came from that explicit method, so it goes too.
            $data['payout_channel'] = null;
            $data['payout_channel_code'] = null;
        }

        $profile->update($data);

        $profile->load('documents');

        return response()->json([
            'data' => new RunnerProfileResource($profile),
            'message' => 'Profile updated successfully.',
        ]);
    }
}
