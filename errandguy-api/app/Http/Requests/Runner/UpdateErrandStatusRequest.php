<?php

namespace App\Http\Requests\Runner;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateErrandStatusRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'status' => [
                'required',
                'string',
                Rule::in([
                    'heading_to_pickup',
                    'arrived_at_pickup',
                    'picked_up',
                    'in_transit',
                    'arrived_at_dropoff',
                    'delivered',
                    'completed',
                ]),
            ],
            'note' => ['nullable', 'string', 'max:300'],
            'lat' => ['nullable', 'numeric', 'between:-90,90'],
            'lng' => ['nullable', 'numeric', 'between:-180,180'],
            'pickup_photo' => ['required_if:status,picked_up', 'nullable', 'image', 'max:5120'],
            'delivery_photo' => ['required_if:status,delivered', 'nullable', 'image', 'max:5120'],
            'signature' => ['required_if:status,completed', 'nullable', 'image', 'max:5120'],
        ];
    }

    public function messages(): array
    {
        return [
            'pickup_photo.required_if' => 'A pickup photo is required when marking as picked up.',
            'delivery_photo.required_if' => 'A delivery photo is required when marking as delivered.',
            'signature.required_if' => 'A signature is required when marking as completed.',
        ];
    }
}
