<?php

namespace App\Http\Controllers\Runner;

use App\Http\Controllers\Controller;
use App\Http\Resources\BookingResource;
use App\Models\Booking;
use App\Services\RealtimeService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ShoppingChecklistController extends Controller
{
    /** Terminal statuses where a booking's checklist can no longer be ticked. */
    private const CLOSED_STATUSES = ['completed', 'cancelled'];

    public function __construct(
        private RealtimeService $realtime,
    ) {}

    /**
     * PATCH /runner/errand/{id}/shopping-items — tick items off the list.
     *
     * Contract: { "items": [ { "id": "<item-uuid>", "checked": bool }, ... ] }
     *
     * Only the assigned runner may tick, and only while the errand is still
     * active (not completed / cancelled). Each referenced item has its
     * `checked` flag flipped and `checked_at` stamped (or cleared). The
     * updated list is pushed to the customer in real time so they watch the
     * ticks land live.
     */
    public function update(Request $request, string $id): JsonResponse
    {
        $validated = $request->validate([
            'items' => ['required', 'array', 'min:1', 'max:100'],
            'items.*.id' => ['required', 'string'],
            'items.*.checked' => ['required', 'boolean'],
        ]);

        $booking = Booking::findOrFail($id);
        $user = $request->user();

        if ($user->id !== $booking->runner_id) {
            return response()->json([
                'message' => 'You are not assigned to this errand.',
            ], 403);
        }

        if (in_array($booking->status, self::CLOSED_STATUSES, true)) {
            return response()->json([
                'message' => 'This errand is closed — its shopping list can no longer be updated.',
            ], 422);
        }

        $items = $booking->shopping_items ?? [];
        if (empty($items)) {
            return response()->json([
                'message' => 'This booking has no shopping list to update.',
            ], 422);
        }

        // Index the requested checked-state changes by item id.
        $changes = [];
        foreach ($validated['items'] as $change) {
            $changes[$change['id']] = (bool) $change['checked'];
        }

        $now = now()->toIso8601String();
        $items = array_map(function (array $item) use ($changes, $now) {
            if (isset($item['id']) && array_key_exists($item['id'], $changes)) {
                $checked = $changes[$item['id']];
                $item['checked'] = $checked;
                $item['checked_at'] = $checked ? $now : null;
            }

            return $item;
        }, $items);

        $booking->update(['shopping_items' => $items]);

        // Push the fresh list to the customer's realtime channel so ticks land
        // live — but AFTER the response is flushed. The DB write above is the
        // authoritative state; the Supabase PostgREST insert is pure
        // fire-and-forget and its round-trip (no client timeout) must not hold
        // the runner's PATCH open, which is hit on every item tick. Same
        // dispatch(fn)->afterResponse() pattern CacheService's SWR refresh uses.
        // Values are captured by value so the deferred closure is independent of
        // request-scoped state.
        $realtime = $this->realtime;
        $customerId = $booking->customer_id;
        $bookingId = $booking->id;
        dispatch(function () use ($realtime, $customerId, $bookingId, $items) {
            $realtime->insertNotification(
                $customerId,
                'Shopping list updated',
                'Your runner updated the shopping checklist.',
                'shopping_items_updated',
                [
                    'booking_id' => $bookingId,
                    'shopping_items' => $items,
                ],
            );
        })->afterResponse();

        $booking->load(['errandType', 'runner', 'customer', 'statusLogs']);

        return response()->json([
            'data' => new BookingResource($booking),
            'message' => 'Shopping checklist updated.',
        ]);
    }
}
