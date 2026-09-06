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

        $profile->update($request->validated());

        $profile->load('documents');

        return response()->json([
            'data' => new RunnerProfileResource($profile),
            'message' => 'Profile updated successfully.',
        ]);
    }
}
