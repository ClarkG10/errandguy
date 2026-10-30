<?php

namespace App\Http\Requests\Support;

use App\Models\Booking;
use App\Models\SupportTicket;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

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
            // (as customer or runner) may reference it. "Report a problem"
            // from an errand sends it; a report about a person must.
            'booking_id' => [
                Rule::requiredIf(fn (): bool => $this->input('category') === SupportTicket::CATEGORY_REPORT_USER),
                'nullable',
                'uuid',
                Rule::exists('bookings', 'id')->where(function ($query) {
                    $query->where('customer_id', $this->user()->id)
                          ->orWhere('runner_id', $this->user()->id);
                }),
            ],
            // "Report this person": who the report is about — the other person
            // on that errand (checked in after()). Only with category
            // report_user.
            'reported_user_id' => [
                Rule::requiredIf(fn (): bool => $this->input('category') === SupportTicket::CATEGORY_REPORT_USER),
                Rule::prohibitedIf(fn (): bool => $this->input('category') !== SupportTicket::CATEGORY_REPORT_USER),
                'nullable',
                'uuid',
            ],
        ];
    }

    /**
     * A report about a person must name the OTHER person on the errand: not
     * yourself, not someone who was never on it.
     *
     * @return array<int, \Closure>
     */
    public function after(): array
    {
        return [
            function (Validator $validator): void {
                if ($this->input('category') !== SupportTicket::CATEGORY_REPORT_USER
                    || $validator->errors()->hasAny(['booking_id', 'reported_user_id'])) {
                    return;
                }

                $booking = Booking::find($this->input('booking_id'));
                $me = (string) $this->user()->id;
                $others = array_filter(
                    [(string) $booking?->customer_id, (string) $booking?->runner_id],
                    fn (string $id): bool => $id !== '' && $id !== $me,
                );

                if (! in_array((string) $this->input('reported_user_id'), $others, true)) {
                    $validator->errors()->add('reported_user_id', 'You can only report the other person on this errand.');
                }
            },
        ];
    }

    public function messages(): array
    {
        return [
            'booking_id.exists' => 'The selected booking does not belong to you.',
            'booking_id.required' => 'Choose the errand this report is about.',
            'reported_user_id.required' => 'Choose the person you are reporting.',
            'reported_user_id.prohibited' => 'Only a report about a person can name someone.',
        ];
    }
}
