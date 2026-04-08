<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
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
        $documents = RunnerDocument::where('user_id', $userId)
            ->orderByDesc('created_at')
            ->get();

        return response()->json(['data' => $documents]);
    }

    public function approve(Request $request, string $userId): JsonResponse
    {
        $profile = RunnerProfile::where('user_id', $userId)->firstOrFail();
        $profile->update([
            'verification_status' => 'approved',
            'verified_at' => now(),
        ]);

        // Mark all pending documents as approved
        RunnerDocument::where('user_id', $userId)
            ->where('status', 'pending')
            ->update(['status' => 'approved', 'reviewed_at' => now()]);

        $this->notificationService->sendPush(
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

        RunnerDocument::where('user_id', $userId)
            ->where('status', 'pending')
            ->update([
                'status' => 'rejected',
                'rejection_reason' => $request->input('reason'),
                'reviewed_at' => now(),
            ]);

        $this->notificationService->sendPush(
            $userId,
            'Verification Update',
            'Your runner verification was not approved. Please check the details and resubmit.',
            ['type' => 'document_update']
        );

        return response()->json(['message' => 'Runner rejected']);
    }
}
