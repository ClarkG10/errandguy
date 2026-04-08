<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class NotificationResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'user_id' => $this->user_id,
            'title' => $this->title,
            'body' => $this->body,
            'type' => $this->type,
            'data' => $this->data,
            'is_read' => $this->is_read,
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
