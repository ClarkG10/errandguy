<?php

namespace App\Http\Controllers\Chat;

use App\Http\Controllers\Controller;
use App\Http\Requests\Chat\SendMessageRequest;
use App\Http\Resources\MessageResource;
use App\Models\Booking;
use App\Models\Message;
use Illuminate\Support\Facades\DB;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class ChatController extends Controller
{
    public function index(Request $request, string $bookingId): JsonResponse
    {
        $booking = Booking::findOrFail($bookingId);

        $this->authorizeBookingParticipant($request->user(), $booking);

        // Cursor-based pagination keyed by created_at. The mobile chat
        // renders oldest-to-newest, so we always return ASC. To load
        // older messages, the client passes ?before=<iso8601>; we then
        // grab the page of messages strictly OLDER than that point
        // (still ordered ASC for the client to prepend).
        $limit = min(max($request->integer('limit', 50), 1), 100);
        $before = $request->input('before');

        // Pull `limit + 1` to know if there are still older messages
        // beyond this page — the extra row is dropped before serializing.
        $query = Message::query()
            ->where('booking_id', $bookingId)
            ->with('sender:id,full_name,avatar_url')
            ->orderByDesc('created_at')
            ->orderByDesc('id'); // tiebreaker for messages with identical timestamps

        if ($before) {
            try {
                $beforeTs = \Carbon\Carbon::parse($before);
                $query->where('created_at', '<', $beforeTs);
            } catch (\Throwable $e) {
                // Bad cursor — ignore and return the latest page.
            }
        }

        $rows = $query->limit($limit + 1)->get();
        $hasMore = $rows->count() > $limit;
        $page = $rows->take($limit)->reverse()->values(); // ASC for client

        return response()->json([
            'data' => MessageResource::collection($page),
            'meta' => [
                'has_more' => $hasMore,
                'next_before' => $hasMore ? $page->first()?->created_at?->toIso8601String() : null,
            ],
        ]);
    }

    public function store(SendMessageRequest $request, string $bookingId): JsonResponse
    {
        $booking = Booking::findOrFail($bookingId);

        $this->authorizeBookingParticipant($request->user(), $booking);

        if (in_array($booking->status, ['completed', 'cancelled'])) {
            return response()->json([
                'message' => 'Cannot send messages on a closed booking.',
            ], 422);
        }

        $validated = $request->validated();

        // Inline image upload — the mobile client sends a local file URI
        // through multipart/form-data, we persist it on the public disk
        // and store the resulting CDN URL on the message row. The legacy
        // image_url path stays for system-issued or pre-hosted images.
        $imageUrl = $validated['image_url'] ?? null;
        if ($request->hasFile('image')) {
            $path = $request->file('image')->store(
                'chat-images/' . $bookingId,
                'public'
            );
            $imageUrl = Storage::disk('public')->url($path);
        }

        $message = Message::create([
            'booking_id' => $bookingId,
            'sender_id' => $request->user()->id,
            'content' => $validated['content'] ?? null,
            'image_url' => $imageUrl,
            'is_system' => false,
        ]);

        $message->load('sender:id,full_name,avatar_url');

        return response()->json([
            'data' => new MessageResource($message),
        ], 201);
    }

    public function markAsRead(Request $request, string $bookingId): JsonResponse
    {
        $booking = Booking::findOrFail($bookingId);

        $this->authorizeBookingParticipant($request->user(), $booking);

        Message::where('booking_id', $bookingId)
            ->where('sender_id', '!=', $request->user()->id)
            ->whereNull('read_at')
            ->update(['read_at' => now()]);

        return response()->json([
            'message' => 'Messages marked as read.',
        ]);
    }

    /**
     * Returns the per-booking and total unread chat-message counts for the
     * current user. Used to drive the chat icon badge on the runner errand
     * screen and the customer tracking screen.
     */
    public function unreadCount(Request $request): JsonResponse
    {
        $userId = $request->user()->id;

        // Active bookings the user is a participant of.
        $bookingIds = Booking::query()
            ->where(function ($q) use ($userId) {
                $q->where('customer_id', $userId)->orWhere('runner_id', $userId);
            })
            ->whereNotIn('status', ['completed', 'cancelled', 'no_runner'])
            ->pluck('id');

        if ($bookingIds->isEmpty()) {
            return response()->json([
                'data' => ['total' => 0, 'by_booking' => (object) []],
            ]);
        }

        $rows = Message::query()
            ->whereIn('booking_id', $bookingIds)
            ->where('sender_id', '!=', $userId)
            ->whereNull('read_at')
            ->selectRaw('booking_id, COUNT(*) as unread')
            ->groupBy('booking_id')
            ->get();

        $byBooking = $rows->mapWithKeys(fn ($r) => [(string) $r->booking_id => (int) $r->unread]);

        return response()->json([
            'data' => [
                'total' => (int) $rows->sum('unread'),
                'by_booking' => $byBooking->isEmpty() ? (object) [] : $byBooking,
            ],
        ]);
    }

    /**
     * Inbox: list bookings the user is a participant of, with the last
     * message preview, unread count, and the counterparty's identity.
     *
     * Active bookings are always included (even with no messages yet so
     * the user can still tap through to start a conversation). Closed
     * bookings only appear if at least one message was exchanged within
     * the last 14 days — otherwise old completed errands would clutter
     * the inbox indefinitely.
     */
    public function conversations(Request $request): JsonResponse
    {
        $userId = $request->user()->id;

        $bookings = Booking::query()
            ->where(function ($q) use ($userId) {
                $q->where('customer_id', $userId)->orWhere('runner_id', $userId);
            })
            ->with([
                'customer:id,full_name,avatar_url',
                'runner:id,full_name,avatar_url',
                'errandType:id,name',
            ])
            ->orderByDesc('updated_at')
            ->limit(60)
            ->get();

        if ($bookings->isEmpty()) {
            return response()->json(['data' => []]);
        }

        $bookingIds = $bookings->pluck('id');

        // Latest message per booking. Previously we hydrated EVERY
        // message row across all 60 bookings just to keep the first one
        // of each group — that's O(history) memory + bandwidth on each
        // inbox open. Postgres `DISTINCT ON` picks the newest row per
        // booking_id directly in SQL with the new
        // (booking_id, created_at) composite index.
        $latestRows = DB::table('messages')
            ->whereIn('booking_id', $bookingIds)
            ->orderBy('booking_id')
            ->orderByDesc('created_at')
            ->select('booking_id', 'content', 'image_url', 'is_system', 'sender_id', 'created_at')
            ->distinct('booking_id')
            ->get();
        $latestPerBooking = collect($latestRows)->keyBy('booking_id');

        // Unread counts per booking for messages not sent by the user.
        $unreadPerBooking = Message::query()
            ->whereIn('booking_id', $bookingIds)
            ->where('sender_id', '!=', $userId)
            ->whereNull('read_at')
            ->selectRaw('booking_id, COUNT(*) as unread')
            ->groupBy('booking_id')
            ->pluck('unread', 'booking_id');

        $cutoff = now()->subDays(14);
        $isActive = fn (Booking $b) => ! in_array($b->status, ['completed', 'cancelled', 'no_runner']);

        $items = $bookings
            ->map(function (Booking $b) use ($userId, $latestPerBooking, $unreadPerBooking, $cutoff, $isActive) {
                $last = $latestPerBooking->get($b->id);
                $hasRecentMsg = $last && \Carbon\Carbon::parse($last->created_at)->gte($cutoff);

                if (! $isActive($b) && ! $hasRecentMsg) {
                    return null;
                }

                $isCustomer = $userId === $b->customer_id;
                $other = $isCustomer ? $b->runner : $b->customer;

                $preview = null;
                if ($last) {
                    if ($last->is_system) {
                        $preview = $last->content;
                    } elseif ($last->image_url) {
                        $preview = '📷 Photo';
                    } else {
                        $preview = $last->content;
                    }
                }

                return [
                    'booking_id' => (string) $b->id,
                    'booking_number' => $b->booking_number,
                    'status' => $b->status,
                    'errand_type' => $b->errandType ? ['id' => (string) $b->errandType->id, 'name' => $b->errandType->name] : null,
                    'counterparty' => $other ? [
                        'id' => (string) $other->id,
                        'full_name' => $other->full_name,
                        'avatar_url' => $other->avatar_url,
                    ] : null,
                    'last_message' => $last ? [
                        'preview' => $preview,
                        'is_image' => (bool) $last->image_url,
                        'is_system' => (bool) $last->is_system,
                        'is_outgoing' => $last->sender_id === $userId,
                        'created_at' => optional($last->created_at)->toIso8601String(),
                    ] : null,
                    'unread_count' => (int) ($unreadPerBooking->get($b->id) ?? 0),
                    'sort_ts' => $last ? \Carbon\Carbon::parse($last->created_at)->timestamp : \Carbon\Carbon::parse($b->updated_at)->timestamp,
                ];
            })
            ->filter()
            ->sortByDesc('sort_ts')
            ->values()
            ->map(function ($row) {
                unset($row['sort_ts']);
                return $row;
            });

        return response()->json(['data' => $items]);
    }

    private function authorizeBookingParticipant($user, Booking $booking): void
    {
        if ($user->id !== $booking->customer_id && $user->id !== $booking->runner_id) {
            abort(403, 'You are not a participant of this booking.');
        }
    }
}
