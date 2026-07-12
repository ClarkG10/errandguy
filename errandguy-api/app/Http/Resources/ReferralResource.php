<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ReferralResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'referrer_id' => $this->referrer_id,
            'referee_id' => $this->referee_id,
            'status' => $this->status,
            'reward_amount' => $this->reward_amount !== null
                ? (float) $this->reward_amount
                : null,
            'qualified_at' => $this->qualified_at?->toIso8601String(),
            'rewarded_at' => $this->rewarded_at?->toIso8601String(),
            'created_at' => $this->created_at?->toIso8601String(),
            'referee' => $this->when(
                $this->relationLoaded('referee') && $this->referee,
                fn () => new UserResource($this->referee),
            ),
        ];
    }
}
