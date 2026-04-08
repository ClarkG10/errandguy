<?php

namespace App\Http\Requests\Runner;

use Illuminate\Foundation\Http\FormRequest;

class UpdateLocationRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'lat' => ['required', 'numeric', 'between:-90,90'],
            'lng' => ['required', 'numeric', 'between:-180,180'],
            'heading' => ['nullable', 'numeric'],
            'speed' => ['nullable', 'numeric', 'min:0'],
            'accuracy' => ['nullable', 'numeric', 'min:0'],
        ];
    }
}
