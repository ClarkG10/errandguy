<?php

namespace App\Http\Requests\Booking;

use App\Models\ErrandType;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class EstimateRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** A merged retired type is priced as the type that replaced it (see CreateBookingRequest). */
    protected function prepareForValidation(): void
    {
        if ($this->has('errand_type_id')) {
            $this->merge(['errand_type_id' => ErrandType::bookableIdFor($this->input('errand_type_id'))]);
        }
    }

    public function rules(): array
    {
        return [
            'errand_type_id' => [
                'bail',
                'required',
                'string',
                function (string $attribute, mixed $value, \Closure $fail): void {
                    if ($message = ErrandType::removedTypeMessage($value)) {
                        $fail($message);
                    }
                },
                Rule::exists('errand_types', 'id')->where('is_active', true),
            ],
            'pickup_lat' => ['required', 'numeric', 'between:-90,90'],
            'pickup_lng' => ['required', 'numeric', 'between:-180,180'],
            // Single-location errands (queue) submit only
            // pickup coords. PricingService::estimate() already collapses
            // distance to 0 when dropoff is missing, so make these optional.
            'dropoff_lat' => ['nullable', 'numeric', 'between:-90,90'],
            'dropoff_lng' => ['nullable', 'numeric', 'between:-180,180'],
            // Multi-stop quote: only coordinates are needed to price the extra
            // legs + per-stop fee (addresses/contacts are collected at create).
            'stops' => ['nullable', 'array', 'max:3'],
            'stops.*.lat' => ['required_with:stops', 'numeric', 'between:-90,90'],
            'stops.*.lng' => ['required_with:stops', 'numeric', 'between:-180,180'],
            'vehicle_type_rate' => [
                'nullable',
                Rule::in(['walk', 'bicycle', 'motorcycle', 'car']),
            ],
        ];
    }
}
