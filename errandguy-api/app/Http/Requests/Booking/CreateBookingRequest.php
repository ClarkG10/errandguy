<?php

namespace App\Http\Requests\Booking;

use App\Models\ErrandType;
use App\Models\PaymentMethod;
use App\Services\PaymentMethodCatalog;
use App\Support\VehicleClass;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class CreateBookingRequest extends FormRequest
{
    /**
     * Errand types that fulfill at a single location and don't have a separate
     * dropoff (the runner does the task on-site). Must stay in sync with mobile
     * errandTypeRules.ts singleLocation flag and
     * RunnerErrandController::SINGLE_LOCATION_SLUGS.
     *
     * This list and SHOPPING_SLUGS name BOOKABLE slugs only — errand_type_id
     * must be an active type. Retired slugs live on as runner-side legacy
     * aliases (UpdateErrandStatusRequest, RunnerErrandController) so errands
     * booked before the retirement can still finish.
     */
    private const SINGLE_LOCATION_SLUGS = ['queue'];

    /**
     * Errand types where the runner spends the customer's money against a cap
     * and captures a receipt ("Buy for me") — matching UpdateErrandStatusRequest
     * (receipt + actual cost required at pickup) and the mobile errandTypeRules
     * budget rule.
     */
    private const SHOPPING_SLUGS = ['purchase'];

    public function authorize(): bool
    {
        return true;
    }

    /**
     * Accepted payment_method values: the operator-enabled one-time catalog
     * PLUS the type of any reusable method the customer has already linked
     * (a linked GrabPay isn't in the one-time catalog, but must be payable).
     */
    private function allowedPaymentMethods(): array
    {
        $saved = $this->user()
            ? PaymentMethod::where('user_id', $this->user()->id)
                ->where('status', 'active')
                ->pluck('type')
                ->all()
            : [];

        return array_values(array_unique([...PaymentMethodCatalog::enabledTypes(), ...$saved]));
    }

    public function rules(): array
    {
        $errandType = $this->input('errand_type_id')
            ? ErrandType::find($this->input('errand_type_id'))
            : null;
        $isSingleLocation = $errandType && in_array($errandType->slug, self::SINGLE_LOCATION_SLUGS, true);
        $dropoffRule = $isSingleLocation ? 'nullable' : 'required';
        $isShopping = $errandType && in_array($errandType->slug, self::SHOPPING_SLUGS, true);

        return [
            'errand_type_id' => [
                'required',
                'string',
                Rule::exists('errand_types', 'id')->where('is_active', true),
            ],
            'pickup_address' => ['required', 'string', 'max:500'],
            'pickup_lat' => ['required', 'numeric', 'between:-90,90'],
            'pickup_lng' => ['required', 'numeric', 'between:-180,180'],
            'pickup_contact_name' => ['nullable', 'string', 'max:100'],
            'pickup_contact_phone' => ['nullable', 'string', 'regex:/^(\+63|0)9\d{9}$/'],
            'dropoff_address' => [$dropoffRule, 'string', 'max:500'],
            'dropoff_lat' => [$dropoffRule, 'numeric', 'between:-90,90'],
            'dropoff_lng' => [$dropoffRule, 'numeric', 'between:-180,180'],
            'dropoff_contact_name' => ['nullable', 'string', 'max:100'],
            'dropoff_contact_phone' => ['nullable', 'string', 'regex:/^(\+63|0)9\d{9}$/'],
            // Multi-stop: up to 3 EXTRA destinations after the primary dropoff
            // (4 stops total). Each needs an address + coordinates; contact/note
            // are optional. Priced as extra legs + a per-stop fee (PricingService).
            'stops' => ['nullable', 'array', 'max:3'],
            'stops.*.address' => ['required_with:stops', 'string', 'max:500'],
            'stops.*.lat' => ['required_with:stops', 'numeric', 'between:-90,90'],
            'stops.*.lng' => ['required_with:stops', 'numeric', 'between:-180,180'],
            'stops.*.contact_name' => ['nullable', 'string', 'max:100'],
            'stops.*.contact_phone' => ['nullable', 'string', 'regex:/^(\+63|0)9\d{9}$/'],
            'stops.*.note' => ['nullable', 'string', 'max:300'],
            'description' => ['nullable', 'string', 'max:500'],
            'special_instructions' => ['nullable', 'string', 'max:300'],
            'item_photos' => ['nullable', 'array', 'max:5'],
            // Raster-only (no SVG) — see UpdateErrandStatusRequest: an SVG proof
            // photo is a stored-XSS vector when an admin opens it in the panel.
            'item_photos.*' => ['image', 'mimes:jpeg,jpg,png,webp', 'max:5120'],
            // max caps at a generous ₱10M — a real errand never approaches it,
            // but without it a value above the decimal(10,2) ceiling (₱99.99M)
            // would 500 the caller's own request under strict-mode MySQL.
            'estimated_item_value' => ['nullable', 'numeric', 'min:0', 'max:10000000'],
            // Shopping budget is required for "Buy for me" so the runner has a
            // spending cap before placing the order.
            'shopping_budget' => [
                $isShopping ? 'required' : 'nullable',
                'numeric',
                'min:1',
                'max:50000',
            ],
            // Optional itemized shopping checklist the customer attaches up
            // front ("Buy for me"). Each element only needs a name;
            // qty defaults to 1. checked/checked_at are runner-owned and are
            // normalized server-side, so they are not required here.
            'shopping_items' => ['nullable', 'array', 'max:100'],
            'shopping_items.*.name' => ['required_with:shopping_items', 'string', 'max:200'],
            'shopping_items.*.qty' => ['nullable', 'integer', 'min:1', 'max:999'],
            'schedule_type' => ['required', Rule::in(['now', 'scheduled'])],
            'scheduled_at' => ['required_if:schedule_type,scheduled', 'nullable', 'date', 'after:+30 minutes'],
            // Every errand is fixed price. The app build already on phones may
            // still send pricing_mode ("fixed", or "negotiate" for name your
            // price). A missing or "fixed" mode books normally; "negotiate" is
            // refused rather than quietly charging the full fare to a customer
            // who chose to pay their own offer (a wallet booking is debited at
            // once). customer_offer has no rule, so it never reaches
            // validated().
            'pricing_mode' => ['nullable', Rule::in(['fixed'])],
            'vehicle_type_rate' => ['nullable', Rule::in(VehicleClass::LADDER)],
            // Operator-enabled one-time methods, plus any type the customer has
            // already linked (see allowedPaymentMethods()).
            'payment_method' => ['required', Rule::in($this->allowedPaymentMethods())],
            // Optional: online payments use a Xendit hosted invoice where the
            // customer picks GCash/Maya/card, so a pre-saved method isn't
            // required. When provided it must belong to the requesting user.
            'payment_method_id' => [
                'nullable',
                'string',
                Rule::exists('payment_methods', 'id')
                    ->where(fn ($q) => $q->where('user_id', $this->user()?->id)),
            ],
        ];
    }

    public function withValidator($validator): void
    {
        $validator->after(function ($validator) {
            $errandType = ErrandType::find($this->input('errand_type_id'));

            // Multi-stop only applies to errands that HAVE a dropoff. A
            // single-location errand (queue) is done on-site, so extra stops
            // are meaningless — reject them rather than silently pricing
            // phantom legs from the pickup.
            if (
                $errandType && in_array($errandType->slug, self::SINGLE_LOCATION_SLUGS, true)
                && ! empty($this->input('stops'))
            ) {
                $validator->errors()->add(
                    'stops',
                    'This errand type is completed at a single location and does not support extra stops.',
                );
            }

            // Block scheduling a single-location errand with no scheduled_at
            // edge case where the client sets schedule_type=scheduled but
            // forgets the time (already covered by required_if, but double
            // check that scheduled time is reasonable: not >30 days out).
            if ($this->input('schedule_type') === 'scheduled' && $this->input('scheduled_at')) {
                try {
                    $when = \Carbon\Carbon::parse($this->input('scheduled_at'));
                    // NB: Carbon 3's diffInDays() is SIGNED — for a future
                    // date $when->diffInDays(now()) is negative, so the old
                    // `> 30` check never fired and far-future bookings slipped
                    // through. Compare against the cap directly instead.
                    if ($when->gt(now()->addDays(30))) {
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
            'pricing_mode.in' => 'Name your price is no longer available. Please update the app and book at the fixed price.',
        ];
    }
}
