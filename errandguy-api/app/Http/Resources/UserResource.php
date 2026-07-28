<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class UserResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        // PII / financial fields are only revealed to the user themself.
        // Otherwise, when this resource is nested inside a BookingResource
        // (so the customer sees the runner, or the runner sees the
        // customer), email / wallet_balance would leak across accounts.
        $isSelf = $request->user()?->id === $this->id;

        return [
            'id' => $this->id,
            // Phone stays visible to the counterparty so they can call /
            // SMS during the errand — it's the whole point of the tracking
            // screen's "Call" button.
            'phone' => $this->phone,
            'email' => $this->when($isSelf, $this->email),
            'full_name' => $this->full_name,
            'avatar_url' => $this->avatar_url,
            'role' => $this->role,
            'status' => $this->when($isSelf, $this->status),
            'email_verified' => $this->when($isSelf, $this->email_verified),
            'phone_verified' => $this->when($isSelf, $this->phone_verified),
            'wallet_balance' => $this->when($isSelf, $this->wallet_balance),
            // Non-withdrawable promotional balance (referral/welcome bonuses).
            // Spendable on errands but excluded from payout; surfaced so the
            // app can show total spendable = wallet_balance + bonus_balance.
            'bonus_balance' => $this->when($isSelf, $this->bonus_balance),
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
