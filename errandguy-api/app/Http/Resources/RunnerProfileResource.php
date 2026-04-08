<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class RunnerProfileResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'user_id' => $this->user_id,
            'verification_status' => $this->verification_status,
            'vehicle_type' => $this->vehicle_type,
            'vehicle_plate' => $this->vehicle_plate,
            'vehicle_photo_url' => $this->vehicle_photo_url,
            'is_online' => $this->is_online,
            'current_lat' => $this->current_lat,
            'current_lng' => $this->current_lng,
            'last_location_at' => $this->last_location_at,
            'acceptance_rate' => $this->acceptance_rate,
            'completion_rate' => $this->completion_rate,
            'total_errands' => $this->total_errands,
            'total_earnings' => $this->total_earnings,
            'preferred_types' => $this->preferred_types,
            'working_area_lat' => $this->working_area_lat,
            'working_area_lng' => $this->working_area_lng,
            'working_area_radius' => $this->working_area_radius,
            'bank_name' => $this->bank_name,
            'ewallet_number' => $this->ewallet_number,
            'approved_at' => $this->approved_at,
            'documents' => $this->when(
                $this->relationLoaded('documents'),
                fn () => RunnerDocumentResource::collection($this->documents),
            ),
        ];
    }
}
