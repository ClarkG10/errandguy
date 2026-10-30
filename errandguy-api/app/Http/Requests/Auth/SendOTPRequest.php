<?php

namespace App\Http\Requests\Auth;

use App\Http\Requests\Concerns\NormalizesPhoneNumbers;
use Illuminate\Foundation\Http\FormRequest;

class SendOTPRequest extends FormRequest
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
