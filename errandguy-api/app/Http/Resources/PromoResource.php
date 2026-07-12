<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class PromoResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'code' => $this->code,
            'description' => $this->description,
            'discount_type' => $this->discount_type,
            // Cast the decimal:2 columns to float so the API emits JSON
            // numbers, not the strings Laravel's decimal cast produces —
            // the mobile Promo type expects numbers and feeds these straight
            // into formatCurrency (which silently no-ops on a string).
            'discount_value' => (float) $this->discount_value,
            'max_discount' => $this->max_discount !== null ? (float) $this->max_discount : null,
            'min_order' => $this->min_order !== null ? (float) $this->min_order : null,
            'valid_until' => $this->valid_until?->toIso8601String(),
        ];
    }
}
