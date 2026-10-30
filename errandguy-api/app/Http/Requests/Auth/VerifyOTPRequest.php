<?php

namespace App\Http\Requests\Auth;

use App\Http\Requests\Concerns\NormalizesPhoneNumbers;
use App\Support\DeviceSessions;
use Illuminate\Foundation\Http\FormRequest;

class VerifyOTPRequest extends FormRequest
{
    use NormalizesPhoneNumbers;

    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        $this->normalizePhoneFields(['phone']);
    }

    public function rules(): array
    {
        return [
            'phone' => ['required_without:email', 'nullable', 'string'],
            'email' => ['required_without:phone', 'nullable', 'string', 'email'],
            'code' => ['required', 'string', 'digits:6'],
            ...DeviceSessions::rules(),
        ];
    }
}
