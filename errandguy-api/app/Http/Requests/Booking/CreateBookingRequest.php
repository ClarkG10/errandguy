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
        // Errand types that fulfill at a single location and don't have
        // a separate dropoff (the runner does the task on-site).
        // Must stay in sync with mobile errandTypeRules.ts singleLocation flag
        // and RunnerErrandController::SINGLE_LOCATION_SLUGS.
        $singleLocationSlugs = ['queue', 'bills_payment'];
        $errandType = $this->input('errand_type_id')
            ? ErrandType::find($this->input('errand_type_id'))
            : null;
        $isSingleLocation = $errandType && in_array($errandType->slug, $singleLocationSlugs, true);
        $dropoffRule = $isSingleLocation ? 'nullable' : 'required';

        // Errand types where the runner buys items on the customer's behalf.
        $shoppingSlugs = ['food', 'grocery', 'purchase'];
        $isShopping = $errandType && in_array($errandType->slug, $shoppingSlugs, true);

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
            'dropoff_address' => [$dropoffRule, 'string'],
            'dropoff_lat' => [$dropoffRule, 'numeric', 'between:-90,90'],
            'dropoff_lng' => [$dropoffRule, 'numeric', 'between:-180,180'],
            'dropoff_contact_name' => ['nullable', 'string', 'max:100'],
            'dropoff_contact_phone' => ['nullable', 'string', 'regex:/^(\+63|0)9\d{9}$/'],
            'description' => ['nullable', 'string', 'max:500'],
            'special_instructions' => ['nullable', 'string', 'max:300'],
            'item_photos' => ['nullable', 'array', 'max:5'],
            'item_photos.*' => ['image', 'max:5120'],
            'estimated_item_value' => ['nullable', 'numeric', 'min:0'],
            // Shopping budget is required for food/grocery/purchase so the
            // runner has a spending cap before placing the order.
            'shopping_budget' => [
                $isShopping ? 'required' : 'nullable',
                'numeric',
                'min:1',
                'max:50000',
            ],
            'schedule_type' => ['required', Rule::in(['now', 'scheduled'])],
            'scheduled_at' => ['required_if:schedule_type,scheduled', 'nullable', 'date', 'after:+30 minutes'],
            'pricing_mode' => ['required', Rule::in(['fixed', 'negotiate'])],
            'vehicle_type_rate' => [
                'required_if:pricing_mode,fixed',
                'nullable',
                Rule::in(['walk', 'bicycle', 'motorcycle', 'car']),
            ],
            'customer_offer' => ['required_if:pricing_mode,negotiate', 'nullable', 'numeric', 'min:0'],
            // Only methods the operator currently offers are accepted.
            'payment_method' => ['required', Rule::in(\App\Services\PaymentMethodCatalog::enabledTypes())],
            // Optional: online payments use a Xendit hosted invoice where the
            // customer picks GCash/Maya/card, so a pre-saved method isn't
            // required. When provided it must belong to the requesting user.
            'payment_method_id' => [
                'nullable',
                'string',
                Rule::exists('payment_methods', 'id')
                    ->where(fn ($q) => $q->where('user_id', $this->user()?->id)),
            ],
            'promo_code' => ['nullable', 'string'],
        ];
    }

    public function withValidator($validator): void
    {
        $validator->after(function ($validator) {
            $errandType = ErrandType::find($this->input('errand_type_id'));

            // Validate customer_offer against min_negotiate_fee
            if ($this->input('pricing_mode') === 'negotiate' && $this->input('customer_offer')) {
                if ($errandType && $this->input('customer_offer') < (float) $errandType->min_negotiate_fee) {
                    $validator->errors()->add(
                        'customer_offer',
                        "Minimum offer is ₱{$errandType->min_negotiate_fee}."
                    );
                }
            }

            // Per-type vehicle restrictions. Mirrors mobile errandTypeRules.ts
            // allowedVehicles. Prevents e.g. a "walk" transportation request
            // or a "walk" food run reaching the matching engine.
            $allowed = match ($errandType?->slug) {
                'transportation' => ['motorcycle', 'car'],
                'food' => ['bicycle', 'motorcycle', 'car'],
                default => ['walk', 'bicycle', 'motorcycle', 'car'],
            };
            $vehicle = $this->input('vehicle_type_rate');
            if ($vehicle && ! in_array($vehicle, $allowed, true)) {
                $validator->errors()->add(
                    'vehicle_type_rate',
                    'This vehicle is not available for the selected errand type.',
                );
            }

            // Block scheduling a single-location errand with no scheduled_at
            // edge case where the client sets schedule_type=scheduled but
            // forgets the time (already covered by required_if, but double
            // check that scheduled time is reasonable: not >30 days out).
            if ($this->input('schedule_type') === 'scheduled' && $this->input('scheduled_at')) {
                try {
                    $when = \Carbon\Carbon::parse($this->input('scheduled_at'));
                    if ($when->diffInDays(now()) > 30) {
                        $validator->errors()->add(
                            'scheduled_at',
                            'Bookings can only be scheduled up to 30 days in advance.',
                        );
                    }
                } catch (\Throwable $e) {
                    // The base date rule already covers parse failures.
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
