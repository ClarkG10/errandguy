<?php

namespace App\Http\Controllers\Chat;

use App\Events\ChatMessageSent;
use App\Http\Controllers\Controller;
use App\Http\Requests\Chat\SendMessageRequest;
use App\Http\Resources\MessageResource;
use App\Models\Booking;
use App\Models\Message;
use Illuminate\Support\Facades\DB;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ChatController extends Controller
{
    public function index(Request $request, string $bookingId): JsonResponse
    {
        $booking = Booking::findOrFail($bookingId);

        $this->authorizeBookingParticipant($request->user(), $booking);

        $limit = min(max($request->integer('limit', 50), 1), 100);

        // Forward delta for the polling fallback: `?after=<message id>` returns
        // only messages NEWER than the one the client already holds, ASC. The
        // 8s poll used to re-download the whole 50-row head page every tick and
        // dedupe client-side; this ships just what's new (usually nothing). The
        // cursor is the message id — not a raw timestamp — so a sub-second
        // timestamp collision can never skip a message: we compare on the same
        // (created_at, id) tuple the ordering uses.
        $afterId = $request->input('after');
        if ($afterId) {
            $cursor = Message::where('booking_id', $bookingId)
                ->whereKey($afterId)
                ->first(['id', 'created_at']);

            // Unknown cursor (e.g. the message was purged) → fall through to the
            // head page below so the client can resync from scratch.
            if ($cursor) {
                $rows = Message::query()
                    ->where('booking_id', $bookingId)
                    ->where(function ($q) use ($cursor) {
                        $q->where('created_at', '>', $cursor->created_at)
                            ->orWhere(function ($q2) use ($cursor) {
                                $q2->where('created_at', $cursor->created_at)
                                    ->where('id', '>', $cursor->id);
                            });
                    })
                    ->with('sender:id,full_name,avatar_url')
                    ->orderBy('created_at')
                    ->orderBy('id')
                    ->limit($limit + 1)
                    ->get();

                $hasMore = $rows->count() > $limit;
                $page = $rows->take($limit)->values(); // already ASC

                return response()->json([
                    'data' => MessageResource::collection($page),
                    'meta' => [
                        'mode' => 'after',
                        // More NEWER messages beyond this page (client was far
                        // behind) — poll again with the returned tail id.
                        'has_more' => $hasMore,
                        'next_after' => $page->last()?->id,
                    ],
                ]);
            }
        }

        // Cursor-based pagination keyed by created_at. The mobile chat
        // renders oldest-to-newest, so we always return ASC. To load
        // older messages, the client passes ?before=<iso8601>; we then
        // grab the page of messages strictly OLDER than that point
        // (still ordered ASC for the client to prepend).
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
            // PRIVATE media disk + participant-gated URL (was the public disk):
            // chat images are arbitrary user content and must not be fetchable by
            // URL alone. (audit: booking media was public)
            $imageUrl = \App\Http\Controllers\BookingMediaController::storeAndUrl(
                $request->file('image'),
                'chat-images/'.$bookingId,
            );
        }

        $message = Message::create([
            'booking_id' => $bookingId,
            'sender_id' => $request->user()->id,
            'content' => $validated['content'] ?? null,
            'image_url' => $imageUrl,
            'is_system' => false,
        ]);

        $message->load('sender:id,full_name,avatar_url');

        // Push to the other participant over the `chat.{bookingId}` Reverb
        // channel. The sender already rendered it optimistically; the mobile
        // chat store dedupes by id, so the echo back to the sender is a no-op.
        ChatMessageSent::dispatch($message);

        // Wake the OTHER participant with a device push — the Reverb broadcast
        // above only reaches a foregrounded app. Queued + device-push-only (no
        // inbox row: the message lives in the chat thread), and routed so the
        // tap deep-links straight into this conversation.
        $senderId = $request->user()->id;
        $recipientId = $booking->customer_id === $senderId
            ? $booking->runner_id
            : $booking->customer_id;
        if ($recipientId) {
            \App\Jobs\SendPushJob::dispatch(
                $recipientId,
                $message->sender?->full_name ?: 'New message',
                $message->content
                    ? \Illuminate\Support\Str::limit($message->content, 120)
                    : 'Sent a photo',
                ['type' => 'chat', 'booking_id' => $bookingId],
                true,
            );
        }

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
                // `slug` drives the client's type-aware status vocabulary — a
                // bills-payment thread must not claim an item was "Picked up".
                'errandType:id,name,slug',
            ])
            ->orderByDesc('updated_at')
            ->limit(60)
            ->get();

        if ($bookings->isEmpty()) {
            return response()->json(['data' => []]);
        }

        $bookingIds = $bookings->pluck('id');

        // Latest message per booking, picked in SQL with a window function so
        // we never hydrate the full history. ROW_NUMBER() OVER (PARTITION BY
        // ...) is portable across MySQL 8, Postgres and SQLite 3.25+ — unlike
        // Postgres `DISTINCT ON`, which MySQL does not support (there
        // ->distinct('booking_id') would de-dupe on the whole row and return
        // many rows per booking). Backed by the (booking_id, created_at) index.
        $ranked = DB::table('messages')
            ->whereIn('booking_id', $bookingIds)
            ->select('booking_id', 'content', 'image_url', 'is_system', 'sender_id', 'created_at')
            ->selectRaw('row_number() over (partition by booking_id order by created_at desc) as rn');
        $latestRows = DB::query()->fromSub($ranked, 't')->where('rn', 1)->get();
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
                    'errand_type' => $b->errandType ? [
                        'id' => (string) $b->errandType->id,
                        'name' => $b->errandType->name,
                        'slug' => $b->errandType->slug,
                    ] : null,
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
