<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class EarningsResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'period' => $this->resource['period'],
            'total_earnings' => $this->resource['total_earnings'],
            'total_errands' => $this->resource['total_errands'],
            'avg_per_errand' => $this->resource['avg_per_errand'],
            'acceptance_rate' => $this->resource['acceptance_rate'],
            'completion_rate' => $this->resource['completion_rate'],
            'online_hours' => $this->resource['online_hours'] ?? null,
        ];
    }
}
