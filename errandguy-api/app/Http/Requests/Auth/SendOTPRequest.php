<?php

namespace App\Http\Requests\Auth;

use Illuminate\Foundation\Http\FormRequest;

class SendOTPRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'phone' => [
                'required_without:email',
                'nullable',
                'string',
                'regex:/^(\+63|0)9\d{9}$/',
            ],
            'email' => [
                'required_without:phone',
                'nullable',
                'string',
                'email',
            ],
        ];
    }

    public function messages(): array
    {
        return [
            'phone.regex' => 'Please enter a valid Philippine phone number.',
        ];
    }
}
