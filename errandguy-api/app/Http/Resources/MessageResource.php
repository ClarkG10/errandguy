<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class MessageResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'booking_id' => $this->booking_id,
            'sender_id' => $this->sender_id,
            'sender' => $this->whenLoaded('sender', fn () => [
                'id' => $this->sender->id,
                'full_name' => $this->sender->full_name,
                'avatar_url' => $this->sender->avatar_url,
            ]),
            'content' => $this->content,
            'image_url' => $this->image_url,
            'is_system' => $this->is_system,
            'read_at' => $this->read_at?->toIso8601String(),
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
