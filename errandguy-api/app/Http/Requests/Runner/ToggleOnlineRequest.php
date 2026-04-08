<?php

namespace App\Http\Requests\Runner;

use Illuminate\Foundation\Http\FormRequest;

class ToggleOnlineRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'is_online' => ['required', 'boolean'],
            'lat' => ['required_if:is_online,true', 'nullable', 'numeric', 'between:-90,90'],
            'lng' => ['required_if:is_online,true', 'nullable', 'numeric', 'between:-180,180'],
        ];
    }

    public function messages(): array
    {
        return [
            'lat.required_if' => 'Location is required when going online.',
            'lng.required_if' => 'Location is required when going online.',
        ];
    }
}
