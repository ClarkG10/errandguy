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
            // Bound to the signed SMALLINT column (priority column max 32767).
            // Without an upper bound, a value above 32767 passed validation and
            // then raised SQLSTATE 22003 "Out of range value" on the user's own
            // create/update under MySQL strict mode — an uncaught 500.
            // Semantically priority is 1..5 (max 5 trusted contacts), but the
            // column bound is the hard guard against the overflow.
            'priority' => ['sometimes', 'integer', 'min:1', 'max:32767'],
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
