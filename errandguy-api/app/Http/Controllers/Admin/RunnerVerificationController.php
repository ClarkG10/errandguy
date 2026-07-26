<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Jobs\SendPushJob;
use App\Models\RunnerDocument;
use App\Models\RunnerProfile;
use App\Services\NotificationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class RunnerVerificationController extends Controller
{
    public function __construct(
        private NotificationService $notificationService,
    ) {}

    public function pending(): JsonResponse
    {
        $pending = RunnerProfile::with(['user:id,full_name,email,phone,avatar_url', 'documents'])
            ->where('verification_status', 'pending')
            ->orderBy('created_at')
            ->paginate(20);

        return response()->json($pending);
    }

    public function showDocuments(string $userId): JsonResponse
    {
        // runner_documents are keyed by the runner PROFILE id (runner_id), not
        // the user id — there is no user_id column, so the old query errored.
        $profile = RunnerProfile::where('user_id', $userId)->first();

        $documents = $profile
            ? RunnerDocument::where('runner_id', $profile->id)
                ->orderByDesc('created_at')
                ->get()
            : collect();

        return response()->json(['data' => $documents]);
    }

    public function approve(Request $request, string $userId): JsonResponse
    {
        $profile = RunnerProfile::where('user_id', $userId)->firstOrFail();
        $profile->update([
            'verification_status' => 'approved',
            'verified_at' => now(),
        ]);

        // Mark all pending documents as approved (keyed by runner profile id)
        RunnerDocument::where('runner_id', $profile->id)
            ->where('status', 'pending')
            ->update(['status' => 'approved', 'reviewed_at' => now()]);

        // Queue the push so the admin response isn't blocked on Expo/FCM latency. (P33)
        SendPushJob::dispatch(
            $userId,
            'Verification Approved!',
            'Your runner account has been approved. You can now go online and start accepting errands.',
            ['type' => 'document_update']
        );

        return response()->json(['message' => 'Runner approved']);
    }

    public function reject(Request $request, string $userId): JsonResponse
    {
        $request->validate(['reason' => 'required|string|max:500']);

        $profile = RunnerProfile::where('user_id', $userId)->firstOrFail();
        $profile->update([
            'verification_status' => 'rejected',
            'rejection_reason' => $request->input('reason'),
        ]);

        RunnerDocument::where('runner_id', $profile->id)
            ->where('status', 'pending')
            ->update([
                'status' => 'rejected',
                'rejection_reason' => $request->input('reason'),
                'reviewed_at' => now(),
            ]);

        // Queue the push so the admin response isn't blocked on Expo/FCM latency. (P33)
        SendPushJob::dispatch(
            $userId,
            'Verification Update',
            'Your runner verification was not approved. Please check the details and resubmit.',
            ['type' => 'document_update']
        );

        return response()->json(['message' => 'Runner rejected']);
    }
}
