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
        // NOTE: deliberately NO `exists:users,email`. Rejecting unknown emails
        // with a distinct error turned this into a registered-account oracle
        // (unregistered → 422 "No account found" vs registered → 200). The
        // controller now sends the reset only when the user exists but always
        // returns the same generic 200. Mirrors the OTP send flow, which also
        // omits an exists rule for the same reason.
        return [
            'email' => ['required', 'string', 'email'],
        ];
    }
}
