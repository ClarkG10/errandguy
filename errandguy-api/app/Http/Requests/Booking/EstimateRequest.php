<?php

namespace App\Http\Requests\Booking;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class EstimateRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'errand_type_id' => [
                'required',
                'string',
                Rule::exists('errand_types', 'id')->where('is_active', true),
            ],
            'pickup_lat' => ['required', 'numeric', 'between:-90,90'],
            'pickup_lng' => ['required', 'numeric', 'between:-180,180'],
            'dropoff_lat' => ['required', 'numeric', 'between:-90,90'],
            'dropoff_lng' => ['required', 'numeric', 'between:-180,180'],
            'vehicle_type_rate' => [
                'nullable',
                Rule::in(['walk', 'bicycle', 'motorcycle', 'car']),
            ],
        ];
    }
}
