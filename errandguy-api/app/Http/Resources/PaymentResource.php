<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class PaymentResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'booking_id' => $this->booking_id,
            'customer_id' => $this->customer_id,
            'amount' => (float) $this->amount,
            'currency' => $this->currency,
            'method' => $this->method,
            'status' => $this->status,
            'paid_at' => $this->paid_at?->toIso8601String(),
            'refund_amount' => $this->refund_amount ? (float) $this->refund_amount : null,
            'refunded_at' => $this->refunded_at?->toIso8601String(),
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
