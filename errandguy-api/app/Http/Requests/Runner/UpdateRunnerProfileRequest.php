<?php

namespace App\Http\Requests\Runner;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateRunnerProfileRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'vehicle_type' => ['sometimes', 'string', Rule::in(['walk', 'bicycle', 'motorcycle', 'car'])],
            'vehicle_plate' => ['sometimes', 'nullable', 'string', 'max:20'],
            'preferred_types' => ['sometimes', 'array', 'min:1'],
            'preferred_types.*' => ['string', Rule::exists('errand_types', 'id')->where('is_active', true)],
            'working_area_lat' => ['sometimes', 'numeric', 'between:-90,90'],
            'working_area_lng' => ['sometimes', 'numeric', 'between:-180,180'],
            'working_area_radius' => ['sometimes', 'integer', 'min:1000', 'max:50000'],
            'bank_name' => ['sometimes', 'nullable', 'string', 'max:100'],
            'bank_account_number' => ['sometimes', 'nullable', 'string', 'max:50'],
            'ewallet_number' => ['sometimes', 'nullable', 'string', 'max:20'],
        ];
    }
}
