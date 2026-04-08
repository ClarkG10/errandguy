<?php

namespace App\Http\Requests\Auth;

use Illuminate\Foundation\Http\FormRequest;

class VerifyOTPRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'phone' => ['required_without:email', 'nullable', 'string'],
            'email' => ['required_without:phone', 'nullable', 'string', 'email'],
            'code' => ['required', 'string', 'digits:6'],
        ];
    }
}
