<?php

namespace App\Http\Controllers\Support;

use App\Http\Controllers\Controller;
use App\Http\Requests\Support\CreateTicketRequest;
use App\Http\Requests\Support\SupportMessageRequest;
use App\Http\Resources\SupportMessageResource;
use App\Http\Resources\SupportTicketResource;
use App\Models\SupportMessage;
use App\Models\SupportTicket;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class SupportController extends Controller
{
    /**
     * GET /support/tickets — the caller's own tickets, newest activity first.
     */
    public function index(Request $request): JsonResponse
    {
        $tickets = SupportTicket::query()
            ->forUser($request->user()->id)
            ->orderByRaw('COALESCE(last_message_at, created_at) DESC')
            ->paginate($request->perPage(20));

        return response()->json(
            SupportTicketResource::collection($tickets)->response()->getData(true)
        );
    }

    /**
     * POST /support/tickets — open a support ticket. Creates the ticket plus
     * the first 'user' message in a single transaction.
     *
     * NOTE: This is the structured, threaded successor to the legacy one-shot
     * /support/report closure (which files a DisputeTicket). That closure is
     * intentionally left in place for backwards compatibility.
     */
    public function store(CreateTicketRequest $request): JsonResponse
    {
        $validated = $request->validated();
        $userId = $request->user()->id;

        $ticket = DB::transaction(function () use ($validated, $userId) {
            $now = now();

            $ticket = SupportTicket::create([
                'user_id' => $userId,
                'booking_id' => $validated['booking_id'] ?? null,
                'subject' => $validated['subject'],
                'category' => $validated['category'],
                'status' => 'open',
                'last_message_at' => $now,
            ]);

            SupportMessage::create([
                'ticket_id' => $ticket->id,
                'sender_id' => $userId,
                'sender_type' => 'user',
                'content' => $validated['message'],
            ]);

            return $ticket;
        });

        $ticket->load(['messages' => fn ($q) => $q->orderBy('created_at')]);

        return response()->json([
            'data' => new SupportTicketResource($ticket),
            'message' => 'Support ticket created.',
        ], 201);
    }

    /**
     * GET /support/tickets/{id} — owner-only. Returns the ticket plus a
     * cursor-paginated page of messages (mirrors ChatController::index:
     * newest-page fetched DESC, returned ASC, ?before=<iso8601> cursor to
     * page backwards into older messages).
     */
    public function show(Request $request, string $id): JsonResponse
    {
        $ticket = SupportTicket::findOrFail($id);
        $this->authorizeOwner($request->user(), $ticket);

        $limit = min(max($request->integer('limit', 50), 1), 100);
        $before = $request->input('before');

        $query = SupportMessage::query()
            ->where('ticket_id', $ticket->id)
            ->with('sender:id,full_name,avatar_url')
            ->orderByDesc('created_at')
            ->orderByDesc('id'); // tiebreaker for identical timestamps

        if ($before) {
            try {
                $beforeTs = \Carbon\Carbon::parse($before);
                $query->where('created_at', '<', $beforeTs);
            } catch (\Throwable $e) {
                // Bad cursor — ignore and return the latest page.
            }
        }

        // Pull limit + 1 to know whether older messages remain.
        $rows = $query->limit($limit + 1)->get();
        $hasMore = $rows->count() > $limit;
        $page = $rows->take($limit)->reverse()->values(); // ASC for the client

        return response()->json([
            'data' => [
                'ticket' => new SupportTicketResource($ticket),
                'messages' => SupportMessageResource::collection($page),
            ],
            'meta' => [
                'has_more' => $hasMore,
                'next_before' => $hasMore ? $page->first()?->created_at?->toIso8601String() : null,
            ],
        ]);
    }

    /**
     * POST /support/tickets/{id}/messages — owner-only. Appends a 'user'
     * message and bumps last_message_at. If the ticket was previously
     * resolved/closed, a new user reply re-opens it to 'pending'.
     */
    public function postMessage(SupportMessageRequest $request, string $id): JsonResponse
    {
        $ticket = SupportTicket::findOrFail($id);
        $this->authorizeOwner($request->user(), $ticket);

        $validated = $request->validated();

        $message = DB::transaction(function () use ($ticket, $request, $validated) {
            $now = now();

            $message = SupportMessage::create([
                'ticket_id' => $ticket->id,
                'sender_id' => $request->user()->id,
                'sender_type' => 'user',
                'content' => $validated['content'],
                'image_url' => $validated['image_url'] ?? null,
            ]);

            $ticket->last_message_at = $now;
            if (in_array($ticket->status, ['resolved', 'closed'], true)) {
                $ticket->status = 'pending';
            }
            $ticket->save();

            return $message;
        });

        $message->load('sender:id,full_name,avatar_url');

        return response()->json([
            'data' => new SupportMessageResource($message),
        ], 201);
    }

    // TODO(admin-reply): Agent/operator replies are out of scope for this
    // scaffold. A future admin route (e.g. POST /admin/support/tickets/{id}/reply
    // under the admin group) should create a SupportMessage with
    // sender_type='agent', bump last_message_at, and set status to
    // 'pending'/'resolved' as appropriate, then sendPush() the ticket owner.

    private function authorizeOwner($user, SupportTicket $ticket): void
    {
        if ($user->id !== $ticket->user_id) {
            abort(403, 'You do not have access to this support ticket.');
        }
    }
}
