<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ErrandTypeResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'slug' => $this->slug,
            'name' => $this->name,
            'description' => $this->description,
            'icon_name' => $this->icon_name,
            'base_fee' => $this->base_fee,
            'per_km_walk' => $this->per_km_walk,
            'per_km_bicycle' => $this->per_km_bicycle,
            'per_km_motorcycle' => $this->per_km_motorcycle,
            'per_km_car' => $this->per_km_car,
            'surcharge' => $this->surcharge,
            'min_negotiate_fee' => $this->min_negotiate_fee,
            'is_active' => $this->is_active,
        ];
    }
}
