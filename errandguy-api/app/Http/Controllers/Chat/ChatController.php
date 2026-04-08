<?php

namespace App\Http\Controllers\Chat;

use App\Http\Controllers\Controller;
use App\Http\Requests\Chat\SendMessageRequest;
use App\Http\Resources\MessageResource;
use App\Models\Booking;
use App\Models\Message;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ChatController extends Controller
{
    public function index(Request $request, string $bookingId): JsonResponse
    {
        $booking = Booking::findOrFail($bookingId);

        $this->authorizeBookingParticipant($request->user(), $booking);

        $messages = Message::where('booking_id', $bookingId)
            ->with('sender:id,full_name,avatar_url')
            ->orderByDesc('created_at')
            ->paginate($request->integer('per_page', 50));

        return response()->json(
            MessageResource::collection($messages)->response()->getData(true)
        );
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

        $message = Message::create([
            'booking_id' => $bookingId,
            'sender_id' => $request->user()->id,
            'content' => $validated['content'] ?? null,
            'image_url' => $validated['image_url'] ?? null,
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

    private function authorizeBookingParticipant($user, Booking $booking): void
    {
        if ($user->id !== $booking->customer_id && $user->id !== $booking->runner_id) {
            abort(403, 'You are not a participant of this booking.');
        }
    }
}
