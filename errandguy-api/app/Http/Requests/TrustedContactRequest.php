<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class TrustedContactRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:100'],
            'phone' => ['required', 'string', 'regex:/^(\+63|0)9\d{9}$/'],
            'relationship' => ['required', 'string', 'max:30'],
            'priority' => ['sometimes', 'integer', 'min:1'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }

    public function messages(): array
    {
        return [
            'phone.regex' => 'Phone must be a valid Philippine mobile number.',
        ];
    }
}
