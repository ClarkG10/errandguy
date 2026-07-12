<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class SupportTicketResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'user_id' => $this->user_id,
            'booking_id' => $this->booking_id,
            'subject' => $this->subject,
            'category' => $this->category,
            'status' => $this->status,
            'last_message_at' => $this->last_message_at?->toIso8601String(),
            'created_at' => $this->created_at?->toIso8601String(),
            'messages' => SupportMessageResource::collection($this->whenLoaded('messages')),
            'latest_message' => $this->when(
                $this->relationLoaded('messages') && $this->messages->isNotEmpty(),
                fn () => new SupportMessageResource($this->messages->last())
            ),
        ];
    }
}
