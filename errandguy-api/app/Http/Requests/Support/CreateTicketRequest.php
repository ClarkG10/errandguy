<?php

namespace App\Http\Requests\Support;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class CreateTicketRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'subject' => ['required', 'string', 'max:200'],
            'category' => ['required', 'string', 'max:50'],
            'message' => ['required', 'string', 'max:2000'],
            // Only tickets scoped to a booking the requester actually owns
            // (as customer or runner) may reference it.
            'booking_id' => [
                'nullable',
                'uuid',
                Rule::exists('bookings', 'id')->where(function ($query) {
                    $query->where('customer_id', $this->user()->id)
                          ->orWhere('runner_id', $this->user()->id);
                }),
            ],
        ];
    }

    public function messages(): array
    {
        return [
            'booking_id.exists' => 'The selected booking does not belong to you.',
        ];
    }
}
