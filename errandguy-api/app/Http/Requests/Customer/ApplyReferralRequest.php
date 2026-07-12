<?php

namespace App\Http\Requests\Customer;

use Illuminate\Foundation\Http\FormRequest;

class ApplyReferralRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'code' => ['required', 'string', 'max:12'],
        ];
    }

    public function messages(): array
    {
        return [
            'code.required' => 'A referral code is required.',
        ];
    }
}
