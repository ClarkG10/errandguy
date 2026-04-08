<?php

namespace App\Http\Controllers\Runner;

use App\Http\Controllers\Controller;
use App\Http\Requests\Runner\UpdateRunnerProfileRequest;
use App\Http\Resources\RunnerProfileResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class RunnerProfileController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        $profile = $request->user()->runnerProfile;

        if (!$profile) {
            return response()->json([
                'message' => 'Runner profile not found.',
            ], 404);
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
            return response()->json([
                'message' => 'Runner profile not found.',
            ], 404);
        }

        $profile->update($request->validated());

        $profile->load('documents');

        return response()->json([
            'data' => new RunnerProfileResource($profile),
            'message' => 'Profile updated successfully.',
        ]);
    }
}
