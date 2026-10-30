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
        // Format only. Whether an account uses the address is never revealed:
        // the controller answers the same either way.
        return [
            'email' => ['required', 'string', 'email', 'max:255'],
        ];
    }
}
