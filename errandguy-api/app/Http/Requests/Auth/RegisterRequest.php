<?php

namespace App\Http\Requests\Auth;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Password;

class RegisterRequest extends FormRequest
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
                'max:20',
                'regex:/^(\+63|0)9\d{9}$/',
                'unique:users,phone',
            ],
            'email' => [
                'required_without:phone',
                'nullable',
                'string',
                'email',
                'max:255',
                'unique:users,email',
            ],
            'password' => [
                'required',
                'string',
                Password::min(8)
                    ->mixedCase()
                    ->numbers()
                    ->symbols(),
            ],
            'full_name' => ['required', 'string', 'max:100'],
            'role' => ['required', 'string', 'in:customer,runner'],
        ];
    }

    public function messages(): array
    {
        return [
            'phone.regex' => 'Please enter a valid Philippine phone number (e.g., 09XXXXXXXXX or +639XXXXXXXXX).',
            'phone.unique' => 'This phone number is already registered.',
            'email.unique' => 'This email is already registered.',
        ];
    }
}
