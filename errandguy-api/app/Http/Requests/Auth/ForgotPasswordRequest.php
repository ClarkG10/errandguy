<?php

namespace App\Http\Requests\Auth;

use Illuminate\Foundation\Http\FormRequest;

class ForgotPasswordRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        // Product decision (2026-08): REVEAL whether an email is registered.
        // An unknown address is rejected with a 422 "not registered" that the
        // app renders inline under the email field, instead of the neutral
        // "if an account exists…". Tradeoff explicitly accepted: this makes the
        // endpoint an account-existence oracle (enumeration) — keep the route
        // throttled to blunt bulk probing.
        return [
            'email' => ['required', 'string', 'email', 'exists:users,email'],
        ];
    }

    public function messages(): array
    {
        return [
            'email.exists' => 'This email isn’t registered. Check the address, or create an account.',
        ];
    }
}
