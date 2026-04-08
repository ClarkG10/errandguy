<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateProfileRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        $userId = $this->user()->id;

        return [
            'full_name' => ['sometimes', 'string', 'max:100'],
            'email' => [
                'sometimes',
                'email',
                Rule::unique('users', 'email')->ignore($userId),
            ],
            'phone' => [
                'sometimes',
                'string',
                'regex:/^(\+63|0)9\d{9}$/',
                Rule::unique('users', 'phone')->ignore($userId),
            ],
            'default_lat' => ['sometimes', 'numeric', 'between:-90,90'],
            'default_lng' => ['sometimes', 'numeric', 'between:-180,180'],
        ];
    }

    public function messages(): array
    {
        return [
            'phone.regex' => 'Phone must be a valid Philippine mobile number.',
        ];
    }
}
