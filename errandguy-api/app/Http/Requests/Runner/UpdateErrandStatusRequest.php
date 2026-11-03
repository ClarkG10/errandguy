<?php

namespace App\Http\Requests\Runner;

use App\Models\Booking;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateErrandStatusRequest extends FormRequest
{
    /**
     * Errand-type slugs that require the runner to log a receipt + actual item cost.
     *
     * Only `purchase` ("Buy for me") is bookable. food, grocery and
     * bills_payment are LEGACY aliases for retired (inactive) types, kept so an
     * errand booked before the retirement can still be finished the way it
     * was booked: food/grocery shop like purchase, a bill is paid against a
     * receipt.
     */
    private const SHOPPING_SLUGS = ['purchase', 'food', 'grocery', 'bills_payment'];

    /**
     * Errand-type slugs that finish at a single location (no transit / handover).
     * bills_payment is a legacy alias (see above) — a pre-retirement bill
     * errand still ends at the payment counter.
     */
    private const SINGLE_LOCATION_SLUGS = ['queue', 'bills_payment'];

    /**
     * Why a runner finished a handover without a signature. Nobody at the door,
     * a guard who won't sign, a customer who said "leave it by the gate" — the
     * signature pad used to be a hard wall in every one of those, with a
     * delivery photo already on file. Only offered once that photo is on the
     * booking; the reason is recorded on the completion's status log, which the
     * customer's status history already shows.
     */
    public const NO_SIGNATURE_REASONS = [
        'recipient_unavailable' => 'Recipient not available',
        'left_with_guard' => 'Left with guard or reception',
        'customer_asked' => 'Customer asked me to leave it',
        'other' => 'Other',
    ];

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        $bookingId = $this->route('id');
        $booking = $bookingId ? Booking::with('errandType')->find($bookingId) : null;
        $slug = $booking?->errandType?->slug;
        $isShopping = $slug && in_array($slug, self::SHOPPING_SLUGS, true);
        $isSingleLocation = $slug && in_array($slug, self::SINGLE_LOCATION_SLUGS, true);
        $budget = $booking?->shopping_budget;

        // Pickup photo only makes sense for errands that physically pick up an
        // item with no other proof. A queue errand has no item to photograph at
        // pickup; shopping errands instead capture the RECEIPT at picked_up —
        // that IS the pickup proof — and the mobile app deliberately sends
        // receipt_photo + actual_item_cost (never a separate pickup_photo) at
        // that step. Without skipping the pickup_photo requirement here, marking
        // a shopping errand picked_up 422'd and the runner was permanently stuck.
        $skipPickupPhoto = $isShopping || $slug === 'queue';

        // Single-location errands skip the delivery / signature stages entirely
        // — there is no parcel handover to a recipient.
        $skipDeliveryProof = $isSingleLocation;

        // A signature can be replaced by a stated reason, but only on top of
        // the delivery photo that is already on the booking, and never while
        // money is due at the door: completion settles an unpaid cash fare as
        // collected (and debits the runner's commission) and closes out the
        // item money the runner fronted, so whoever pays can also sign.
        // Mirrors BookingResource::amountToCollect().
        $moneyDue = ($booking?->payment_method === 'cash' && $booking?->payment_status !== 'paid')
            || (float) ($booking?->actual_item_cost ?? 0) > 0;
        $signatureExcused = $this->filled('no_signature_reason')
            && ! empty($booking?->delivery_photo_url)
            && ! $moneyDue;

        return [
            'status' => [
                'required',
                'string',
                Rule::in([
                    'heading_to_pickup',
                    'arrived_at_pickup',
                    'picked_up',
                    'in_transit',
                    'arrived_at_dropoff',
                    'delivered',
                    'completed',
                ]),
            ],
            // "Other" has to say what happened.
            'note' => ['nullable', 'string', 'max:300', 'required_if:no_signature_reason,other'],
            'no_signature_reason' => [
                'nullable',
                'string',
                Rule::in(array_keys(self::NO_SIGNATURE_REASONS)),
            ],
            'lat' => ['nullable', 'numeric', 'between:-90,90'],
            'lng' => ['nullable', 'numeric', 'between:-180,180'],
            'pickup_photo' => [
                $skipPickupPhoto ? 'nullable' : 'required_if:status,picked_up',
                'nullable',
                'image',
                // Raster-only (no SVG): the bare `image` rule accepts SVG, which
                // is served inline as image/svg+xml and can carry <script> that
                // runs same-origin when an admin opens the proof in the panel.
                // Mirrors the chat-image / avatar rules.
                'mimes:jpeg,jpg,png,webp',
                'max:5120',
            ],
            'delivery_photo' => [
                $skipDeliveryProof ? 'nullable' : 'required_if:status,delivered',
                'nullable',
                'image',
                // Raster-only (no SVG): the bare `image` rule accepts SVG, which
                // is served inline as image/svg+xml and can carry <script> that
                // runs same-origin when an admin opens the proof in the panel.
                // Mirrors the chat-image / avatar rules.
                'mimes:jpeg,jpg,png,webp',
                'max:5120',
            ],
            'signature' => [
                $skipDeliveryProof || $signatureExcused ? 'nullable' : 'required_if:status,completed',
                'nullable',
                'image',
                // Raster-only (no SVG): the bare `image` rule accepts SVG, which
                // is served inline as image/svg+xml and can carry <script> that
                // runs same-origin when an admin opens the proof in the panel.
                // Mirrors the chat-image / avatar rules.
                'mimes:jpeg,jpg,png,webp',
                'max:5120',
            ],
            // Shopping reconciliation — required at picked_up for shopping errands.
            'actual_item_cost' => [
                $isShopping ? 'required_if:status,picked_up' : 'nullable',
                'nullable',
                'numeric',
                'min:0',
                $budget ? "max:{$budget}" : 'max:1000000',
            ],
            'receipt_photo' => [
                $isShopping ? 'required_if:status,picked_up' : 'nullable',
                'nullable',
                'image',
                // Raster-only (no SVG): the bare `image` rule accepts SVG, which
                // is served inline as image/svg+xml and can carry <script> that
                // runs same-origin when an admin opens the proof in the panel.
                // Mirrors the chat-image / avatar rules.
                'mimes:jpeg,jpg,png,webp',
                'max:5120',
            ],
        ];
    }

    public function messages(): array
    {
        return [
            'pickup_photo.required_if' => 'A pickup photo is required when marking as picked up.',
            'delivery_photo.required_if' => 'A delivery photo is required when marking as delivered.',
            'signature.required_if' => $this->filled('no_signature_reason')
                ? 'You can only finish without a signature when there’s a delivery photo and no money to collect. Collect the payment and get a signature.'
                : 'A signature is required when marking as completed.',
            'note.required_if' => 'Say briefly why there’s no signature.',
            'actual_item_cost.required_if' => 'Please enter the actual amount you paid for the items.',
            'actual_item_cost.max' => 'Amount cannot exceed the customer’s spending limit for the items.',
            'receipt_photo.required_if' => 'A photo of the receipt is required for shopping errands.',
        ];
    }
}
