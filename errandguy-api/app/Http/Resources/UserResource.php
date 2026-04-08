<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class UserResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'phone' => $this->phone,
            'email' => $this->email,
            'full_name' => $this->full_name,
            'avatar_url' => $this->avatar_url,
            'role' => $this->role,
            'status' => $this->status,
            'email_verified' => $this->email_verified,
            'phone_verified' => $this->phone_verified,
            'wallet_balance' => $this->wallet_balance,
            'avg_rating' => $this->avg_rating,
            'total_ratings' => $this->total_ratings,
            'created_at' => $this->created_at,
            'runner_profile' => $this->when(
                $this->role === 'runner' && $this->relationLoaded('runnerProfile'),
                fn () => new RunnerProfileResource($this->runnerProfile),
            ),
        ];
    }
}
