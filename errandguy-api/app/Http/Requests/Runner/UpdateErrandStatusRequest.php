<?php

namespace App\Http\Requests\Runner;

use App\Models\Booking;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateErrandStatusRequest extends FormRequest
{
    /** Errand-type slugs that require the runner to log a receipt + actual item cost. */
    private const SHOPPING_SLUGS = ['food', 'grocery', 'purchase', 'bills_payment'];

    /** Errand-type slugs that finish at a single location (no transit / handover). */
    private const SINGLE_LOCATION_SLUGS = ['queue', 'bills_payment'];

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

        // Pickup photo only makes sense for errands that physically pick up an item.
        // Transportation, queue, and bills_payment have no item to photograph at pickup.
        $skipPickupPhoto = in_array($slug, ['transportation', 'queue', 'bills_payment'], true);

        // Single-location and transportation errands skip the delivery / signature
        // stages entirely — there is no parcel handover to a recipient.
        $isTransport = $booking?->is_transportation === true;
        $skipDeliveryProof = $isSingleLocation || $isTransport;

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
            'note' => ['nullable', 'string', 'max:300'],
            'lat' => ['nullable', 'numeric', 'between:-90,90'],
            'lng' => ['nullable', 'numeric', 'between:-180,180'],
            'pickup_photo' => [
                $skipPickupPhoto ? 'nullable' : 'required_if:status,picked_up',
                'nullable',
                'image',
                'max:5120',
            ],
            'delivery_photo' => [
                $skipDeliveryProof ? 'nullable' : 'required_if:status,delivered',
                'nullable',
                'image',
                'max:5120',
            ],
            'signature' => [
                $skipDeliveryProof ? 'nullable' : 'required_if:status,completed',
                'nullable',
                'image',
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
                'max:5120',
            ],
        ];
    }

    public function messages(): array
    {
        return [
            'pickup_photo.required_if' => 'A pickup photo is required when marking as picked up.',
            'delivery_photo.required_if' => 'A delivery photo is required when marking as delivered.',
            'signature.required_if' => 'A signature is required when marking as completed.',
            'actual_item_cost.required_if' => 'Please enter the actual amount you paid for the items.',
            'actual_item_cost.max' => 'Amount cannot exceed the customer\u2019s pre-authorized budget.',
            'receipt_photo.required_if' => 'A photo of the receipt is required for shopping errands.',
        ];
    }
}
