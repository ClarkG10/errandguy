<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Jobs\SendPushJob;
use App\Models\DisputeTicket;
use App\Services\NotificationService;
use App\Support\AdminActivity;
use App\Support\ErrorCode;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

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

        // Guard the transition under a row lock so a retry / double-tap can't
        // re-fire the reporter push OR overwrite the original resolver +
        // resolution text with a later admin's (audit-trail corruption). Resolve
        // is idempotent: a repeat on an already-resolved ticket is a no-op ack.
        // Mirrors the lock+precondition pattern the booking/errand paths use.
        $result = DB::transaction(function () use ($request, $id) {
            $dispute = DisputeTicket::whereKey($id)->lockForUpdate()->firstOrFail();

            if ($dispute->status === 'resolved') {
                return ['dispute' => $dispute, 'transitioned' => false];
            }

            $dispute->update([
                // The column is `resolution` (resolution_note is not a
                // dispute_tickets column nor fillable). Stamp the resolver from
                // the sanctum-authenticated admin ($request->user() is the
                // AdminUser here). Mirrors the Filament resolve action.
                'status' => 'resolved',
                'resolution' => $request->input('resolution_note'),
                'resolved_by' => $request->user()->id,
                'resolved_at' => now(),
            ]);

            return ['dispute' => $dispute, 'transitioned' => true];
        });

        if (! $result['transitioned']) {
            return $this->ok(null, 'Dispute already resolved.');
        }

        // Only on a REAL transition: notify the reporter (queued so the admin
        // response isn't blocked on Expo/FCM latency, P33) and record the audit
        // entry — so a repeat never double-notifies or double-logs.
        SendPushJob::dispatch(
            $result['dispute']->reported_by,
            'Dispute Resolved',
            'Your dispute has been reviewed and resolved. Check the details for more info.',
            ['type' => 'system']
        );

        AdminActivity::log('dispute.resolved', $result['dispute'], ['via' => 'api']);

        return $this->ok(null, 'Dispute resolved.');
    }

    public function escalate(string $id): JsonResponse
    {
        // A RESOLVED dispute must not be reopened; escalate is only for a still-
        // open ticket (idempotent no-op if already escalated). Locked so the
        // precondition is authoritative against a concurrent resolve.
        $result = DB::transaction(function () use ($id) {
            $dispute = DisputeTicket::whereKey($id)->lockForUpdate()->firstOrFail();

            if ($dispute->status === 'resolved') {
                return ['dispute' => $dispute, 'blocked' => true, 'transitioned' => false];
            }

            $transitioned = $dispute->status !== 'escalated';
            if ($transitioned) {
                $dispute->update(['status' => 'escalated']);
            }

            return ['dispute' => $dispute, 'blocked' => false, 'transitioned' => $transitioned];
        });

        if ($result['blocked']) {
            return $this->fail(ErrorCode::CONFLICT, 'A resolved dispute cannot be escalated.');
        }

        if ($result['transitioned']) {
            AdminActivity::log('dispute.escalated', $result['dispute'], ['via' => 'api']);
        }

        return $this->ok(null, 'Dispute escalated.');
    }
}
