<?php

namespace App\Http\Requests\Booking;

use App\Http\Requests\Concerns\NormalizesPhoneNumbers;
use App\Models\ErrandType;
use App\Services\PaymentMethodCatalog;
use App\Services\PricingService;
use App\Support\VehicleClass;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class CreateBookingRequest extends FormRequest
{
    use NormalizesPhoneNumbers;

    /**
     * Errand types that fulfill at a single location and don't have a separate
     * dropoff (the runner does the task on-site). Must stay in sync with mobile
     * errandTypeRules.ts singleLocation flag and
     * RunnerErrandController::SINGLE_LOCATION_SLUGS.
     *
     * This list and ErrandType::SHOPPING_SLUGS name BOOKABLE slugs only —
     * errand_type_id must be an active type. Retired slugs live on as
     * runner-side legacy aliases (UpdateErrandStatusRequest,
     * RunnerErrandController) so errands booked before the retirement can
     * still finish.
     */
    private const SINGLE_LOCATION_SLUGS = ['queue'];

    /** Longest description allowed when it carries a written-out shopping list. */
    private const SHOPPING_DESCRIPTION_MAX = 10000;

    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        $this->normalizePhoneFields(['pickup_contact_phone', 'dropoff_contact_phone', 'stops.*.contact_phone']);

        // A merged retired type books the type that replaced it ("Book again"
        // on an old errand in the app build already on phones).
        if ($this->has('errand_type_id')) {
            $this->merge(['errand_type_id' => ErrandType::bookableIdFor($this->input('errand_type_id'))]);
        }
    }

    public function rules(): array
    {
        $errandType = $this->input('errand_type_id')
            ? ErrandType::find($this->input('errand_type_id'))
            : null;
        $isSingleLocation = $errandType && in_array($errandType->slug, self::SINGLE_LOCATION_SLUGS, true);
        $dropoffRule = $isSingleLocation ? 'nullable' : 'required';
        $isShopping = $errandType && in_array($errandType->slug, ErrandType::SHOPPING_SLUGS, true);
        // A shopping list (also on an old food/grocery errand booked again,
        // which becomes "Buy for me") may run long; nothing else needs to.
        $isShoppingList = $errandType
            && in_array(ErrandType::preferenceSlug($errandType->slug), ErrandType::SHOPPING_SLUGS, true)
            && filled($this->input('shopping_items'));

        return [
            'errand_type_id' => [
                'bail',
                'required',
                'string',
                function (string $attribute, mixed $value, \Closure $fail): void {
                    if ($message = ErrandType::removedTypeMessage($value)) {
                        $fail($message);
                    }
                },
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
            // A "Buy for me" list arrives twice: as shopping_items AND written
            // out into the description ("Shopping list:\n• Milk ×2…", the copy
            // runners and staff read). Up to 100 items of up to 80 characters
            // in the app is roughly 9,000 characters, so 500 refused any list
            // past about 18 items. The column is TEXT; any other description
            // keeps its 500 limit.
            'description' => ['nullable', 'string', 'max:'.($isShoppingList ? self::SHOPPING_DESCRIPTION_MAX : 500)],
            'special_instructions' => ['nullable', 'string', 'max:300'],
            'item_photos' => ['nullable', 'array', 'max:5'],
            // Raster-only (no SVG) — see UpdateErrandStatusRequest: an SVG proof
            // photo is a stored-XSS vector when an admin opens it in the panel.
            'item_photos.*' => ['image', 'mimes:jpeg,jpg,png,webp', 'max:5120'],
            // max caps at a generous ₱10M — a real errand never approaches it,
            // but without it a value above the decimal(10,2) ceiling (₱99.99M)
            // would 500 the caller's own request under strict-mode MySQL.
            'estimated_item_value' => ['nullable', 'numeric', 'min:0', 'max:10000000'],
            // "Buy for me": the most the runner may spend on the items. The
            // runner pays out of pocket and the customer repays them in cash at
            // the door, so it is required, and capped by the staff-adjustable
            // shopping_budget_max setting (also served in the errand-types
            // catalog so the app can enforce it up front).
            'shopping_budget' => [
                $isShopping ? 'required' : 'nullable',
                'numeric',
                'min:1',
                'max:'.ErrandType::shoppingBudgetMax(),
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
            'vehicle_type_rate' => [
                'bail',
                'nullable',
                Rule::in(VehicleClass::LADDER),
                // Staff withdraw a vehicle for one errand type by setting its
                // per-km rate to 0, and the quote stops offering it — but a
                // booking still carrying it (an older quote, a stale draft) was
                // accepted and priced on a 0 rate. Checked against the type
                // being booked, after a retired type was remapped above.
                // A queue errand is always booked on foot (the app hides the
                // vehicle picker and sends 'walk'), so walking stays valid for
                // it whatever its rates say.
                function (string $attribute, mixed $value, \Closure $fail) use ($errandType, $isSingleLocation): void {
                    if (! $errandType || ! $errandType->is_active || ($isSingleLocation && $value === 'walk')) {
                        return;
                    }

                    if (! in_array($value, app(PricingService::class)->supportedVehicleTypes($errandType), true)) {
                        $fail(ucfirst(VehicleClass::label($value)).' isn’t available for '.$errandType->name
                            .' right now. Please choose another vehicle.');
                    }
                },
            ],
            // Cash, GCash, Maya or the wallet — whichever the operator has
            // enabled. A retired method (card, GrabPay) that the app build
            // already on phones can still offer gets its own clear refusal
            // first ('bail' stops at it) instead of a bare "invalid value".
            'payment_method' => [
                'bail',
                'required',
                'string',
                function (string $attribute, mixed $value, \Closure $fail): void {
                    if ($message = PaymentMethodCatalog::retiredMessage((string) $value)) {
                        $fail($message);
                    }
                },
                Rule::in(PaymentMethodCatalog::enabledTypes()),
            ],
            // Linked (one-tap) GCash/Maya/GrabPay accounts and saved cards are
            // retired: every online payment is a one-time charge. The app
            // build already on phones only sends an id when the customer picked
            // one of those saved accounts, so any id is refused with a clear
            // message rather than silently charged some other way. Delete
            // this rule once the app update is out.
            'payment_method_id' => [
                function (string $attribute, mixed $value, \Closure $fail): void {
                    if (filled($value)) {
                        $fail('Saved payment accounts are no longer available — please pay with GCash, Maya or cash.');
                    }
                },
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

    /** ₱3,000 / ₱2,500.50 — no centavos when there are none. */
    private static function peso(float $amount): string
    {
        return number_format($amount, fmod($amount, 1.0) === 0.0 ? 0 : 2);
    }

    public function messages(): array
    {
        return [
            'pickup_contact_phone.regex' => 'Pickup phone must be a valid Philippine mobile number.',
            'dropoff_contact_phone.regex' => 'Dropoff phone must be a valid Philippine mobile number.',
            'pricing_mode.in' => 'Name your price is no longer available. Please update the app and book at the fixed price.',
            'payment_method.in' => 'That payment method isn’t available right now — please pay with GCash, Maya, cash or your ErrandGuy wallet.',
            'shopping_budget.max' => 'The most a runner can pay for your items is ₱'.self::peso(ErrandType::shoppingBudgetMax()).'.',
        ];
    }
}
