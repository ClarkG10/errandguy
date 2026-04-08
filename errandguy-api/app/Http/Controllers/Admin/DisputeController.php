<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\DisputeTicket;
use App\Services\NotificationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DisputeController extends Controller
{
    public function __construct(
        private NotificationService $notificationService,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $query = DisputeTicket::with([
            'booking:id,booking_number',
            'reporter:id,full_name,email',
        ]);

        if ($status = $request->query('status')) {
            $query->where('status', $status);
        }

        $disputes = $query->orderByDesc('created_at')->paginate(20);

        return response()->json($disputes);
    }

    public function show(string $id): JsonResponse
    {
        $dispute = DisputeTicket::with([
            'booking.customer:id,full_name,email,phone',
            'booking.runner:id,full_name,email,phone',
            'reporter:id,full_name,email',
        ])->findOrFail($id);

        return response()->json(['data' => $dispute]);
    }

    public function resolve(Request $request, string $id): JsonResponse
    {
        $request->validate([
            'resolution_note' => 'required|string|max:1000',
        ]);

        $dispute = DisputeTicket::findOrFail($id);
        $dispute->update([
            'status' => 'resolved',
            'resolution_note' => $request->input('resolution_note'),
            'resolved_at' => now(),
        ]);

        // Notify reporter
        $this->notificationService->sendPush(
            $dispute->reported_by,
            'Dispute Resolved',
            'Your dispute has been reviewed and resolved. Check the details for more info.',
            ['type' => 'system']
        );

        return response()->json(['message' => 'Dispute resolved']);
    }

    public function escalate(string $id): JsonResponse
    {
        $dispute = DisputeTicket::findOrFail($id);
        $dispute->update(['status' => 'escalated']);

        return response()->json(['message' => 'Dispute escalated']);
    }
}
