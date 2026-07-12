<?php

namespace App\Http\Controllers\Customer;

use App\Http\Controllers\Controller;
use App\Http\Requests\Booking\ShoppingItemsRequest;
use App\Http\Resources\BookingResource;
use App\Models\Booking;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Str;

class ShoppingListController extends Controller
{
    /**
     * Booking statuses where the customer may still edit the shopping list —
     * everything strictly BEFORE the runner picks the items up. Once the
     * runner is at/past pickup the list is locked so the two sides can't
     * fight over what was actually bought.
     */
    private const EDITABLE_STATUSES = [
        'pending',
        'matched',
        'accepted',
        'heading_to_pickup',
        'arrived_at_pickup',
    ];

    /**
     * PUT /bookings/{id}/shopping-items — replace the whole checklist.
     *
     * Owner-only (scoped by customer_id) and only while the booking is still
     * pre-pickup; otherwise 422. The customer never controls the tick state,
     * so `checked` / `checked_at` are always reset to a clean slate here.
     */
    public function update(ShoppingItemsRequest $request, string $id): JsonResponse
    {
        $booking = Booking::where('customer_id', $request->user()->id)->findOrFail($id);

        if (! in_array($booking->status, self::EDITABLE_STATUSES, true)) {
            return response()->json([
                'message' => 'The shopping list can no longer be edited for this booking.',
            ], 422);
        }

        $items = array_map(function (array $item) {
            return [
                'id' => Str::uuid()->toString(),
                'name' => $item['name'],
                'qty' => isset($item['qty']) ? (int) $item['qty'] : 1,
                'checked' => false,
                'checked_at' => null,
            ];
        }, $request->validated('items', []));

        $booking->update(['shopping_items' => $items]);

        $booking->load(['errandType', 'runner', 'customer', 'statusLogs']);

        return response()->json([
            'data' => new BookingResource($booking),
            'message' => 'Shopping list updated.',
        ]);
    }
}
