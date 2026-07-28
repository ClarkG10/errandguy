<?php

namespace App\Events;

use App\Http\Resources\MessageResource;
use App\Models\Message;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * Broadcasts a new chat message to the booking's chat channel. Replaces the
 * Supabase `messages` table subscription. Payload mirrors MessageResource
 * (sender relation loaded) so a message looks identical over the wire whether
 * pushed live or fetched via REST — the mobile chat store dedupes by id, so
 * the sender receiving their own echo is harmless.
 */
class ChatMessageSent implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public Message $message,
    ) {}

    public function broadcastOn(): PrivateChannel
    {
        return new PrivateChannel('chat.' . $this->message->booking_id);
    }

    public function broadcastAs(): string
    {
        return 'message.created';
    }

    public function broadcastWith(): array
    {
        // SerializesModels reloads the message by id in the queue worker, so
        // the sender relation must be re-loaded here before serializing.
        $this->message->loadMissing('sender:id,full_name,avatar_url');

        return (new MessageResource($this->message))->resolve();
    }
}
