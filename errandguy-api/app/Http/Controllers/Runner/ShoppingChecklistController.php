<?php

namespace App\Http\Controllers\Runner;

use App\Http\Controllers\Controller;
use App\Http\Resources\BookingResource;
use App\Models\Booking;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ShoppingChecklistController extends Controller
{
    /** Terminal statuses where a booking's checklist can no longer be ticked. */
    private const CLOSED_STATUSES = ['completed', 'cancelled'];

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

        // Push the fresh list to the customer live so ticks land immediately —
        // but AFTER the response is flushed. The DB write above is the
        // authoritative state; this in-app broadcast is pure fire-and-forget and
        // must not hold the runner's PATCH open, which is hit on every item tick.
        // notifyInApp persists a local Notification and broadcasts it over the
        // customer's `notifications.{userId}` Reverb channel (replacing the old
        // Supabase PostgREST insert) — broadcast-only, so a tick never fires a
        // device push. Same dispatch(fn)->afterResponse() pattern the SWR refresh
        // uses; values captured by value so the closure is request-independent.
        $customerId = $booking->customer_id;
        $bookingId = $booking->id;
        dispatch(function () use ($customerId, $bookingId, $items) {
            app(\App\Services\NotificationService::class)->notifyInApp(
                $customerId,
                'Shopping list updated',
                'Your runner updated the shopping checklist.',
                [
                    'type' => 'shopping_items_updated',
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
