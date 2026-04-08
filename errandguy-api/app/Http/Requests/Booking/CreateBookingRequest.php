<?php

namespace App\Http\Requests\Booking;

use App\Models\ErrandType;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class CreateBookingRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'errand_type_id' => [
                'required',
                'string',
                Rule::exists('errand_types', 'id')->where('is_active', true),
            ],
            'pickup_address' => ['required', 'string'],
            'pickup_lat' => ['required', 'numeric', 'between:-90,90'],
            'pickup_lng' => ['required', 'numeric', 'between:-180,180'],
            'pickup_contact_name' => ['nullable', 'string', 'max:100'],
            'pickup_contact_phone' => ['nullable', 'string', 'regex:/^(\+63|0)9\d{9}$/'],
            'dropoff_address' => ['required', 'string'],
            'dropoff_lat' => ['required', 'numeric', 'between:-90,90'],
            'dropoff_lng' => ['required', 'numeric', 'between:-180,180'],
            'dropoff_contact_name' => ['nullable', 'string', 'max:100'],
            'dropoff_contact_phone' => ['nullable', 'string', 'regex:/^(\+63|0)9\d{9}$/'],
            'description' => ['nullable', 'string', 'max:500'],
            'special_instructions' => ['nullable', 'string', 'max:300'],
            'item_photos' => ['nullable', 'array', 'max:5'],
            'item_photos.*' => ['image', 'max:5120'],
            'estimated_item_value' => ['nullable', 'numeric', 'min:0'],
            'schedule_type' => ['required', Rule::in(['now', 'scheduled'])],
            'scheduled_at' => ['required_if:schedule_type,scheduled', 'nullable', 'date', 'after:+30 minutes'],
            'pricing_mode' => ['required', Rule::in(['fixed', 'negotiate'])],
            'vehicle_type_rate' => [
                'required_if:pricing_mode,fixed',
                'nullable',
                Rule::in(['walk', 'bicycle', 'motorcycle', 'car']),
            ],
            'customer_offer' => ['required_if:pricing_mode,negotiate', 'nullable', 'numeric', 'min:0'],
            'payment_method' => ['required', Rule::in(['card', 'gcash', 'maya', 'wallet', 'cash'])],
            'payment_method_id' => [
                Rule::requiredIf(fn () => !in_array($this->input('payment_method'), ['cash', 'wallet'])),
                'nullable',
                'string',
                Rule::exists('payment_methods', 'id'),
            ],
            'promo_code' => ['nullable', 'string'],
        ];
    }

    public function withValidator($validator): void
    {
        $validator->after(function ($validator) {
            // Validate customer_offer against min_negotiate_fee
            if ($this->input('pricing_mode') === 'negotiate' && $this->input('customer_offer')) {
                $errandType = ErrandType::find($this->input('errand_type_id'));
                if ($errandType && $this->input('customer_offer') < (float) $errandType->min_negotiate_fee) {
                    $validator->errors()->add(
                        'customer_offer',
                        "Minimum offer is ₱{$errandType->min_negotiate_fee}."
                    );
                }
            }
        });
    }

    public function messages(): array
    {
        return [
            'pickup_contact_phone.regex' => 'Pickup phone must be a valid Philippine mobile number.',
            'dropoff_contact_phone.regex' => 'Dropoff phone must be a valid Philippine mobile number.',
        ];
    }
}
