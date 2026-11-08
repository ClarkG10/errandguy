<?php

namespace App\Http\Controllers\Runner;

use App\Enums\BookingStatus;
use App\Http\Controllers\Controller;
use App\Http\Resources\BookingResource;
use App\Models\Booking;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ShoppingChecklistController extends Controller
{
    /** Terminal statuses where a booking's checklist can no longer be ticked. */
    private const CLOSED_STATUSES = BookingStatus::FINALIZED;

    /** Leaves room under Reverb's 10 KB message limit for the rest of the notification. */
    private const LIVE_ITEMS_MAX_BYTES = 7000;

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

        Booking::findOrFail($id);
        $user = $request->user();

        // Index the requested checked-state changes by item id.
        $changes = [];
        foreach ($validated['items'] as $change) {
            $changes[$change['id']] = (bool) $change['checked'];
        }

        // Read, change and write the list under the errand's row lock. The app
        // sends one request per tick, so two quick ticks overlapped and the
        // second write dropped the first; and a tick racing the customer's
        // edit wrote the OLD list back over it. Checked again under the lock:
        // the runner may have been taken off the errand meanwhile.
        $outcome = DB::transaction(function () use ($id, $user, $changes) {
            $booking = Booking::whereKey($id)->lockForUpdate()->firstOrFail();

            if ($user->id !== $booking->runner_id) {
                return [403, 'You are not assigned to this errand.'];
            }
            if (in_array($booking->status, self::CLOSED_STATUSES, true)) {
                return [422, 'This errand is closed — its shopping list can no longer be updated.'];
            }

            $items = $booking->shopping_items ?? [];
            if (empty($items)) {
                return [422, 'This booking has no shopping list to update.'];
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

            return $booking;
        });

        if (is_array($outcome)) {
            return response()->json(['message' => $outcome[1]], $outcome[0]);
        }
        $booking = $outcome;
        $items = $booking->shopping_items;

        // Push the fresh list to the customer live so ticks land immediately —
        // but AFTER the response is flushed. The DB write above is the
        // authoritative state; this in-app broadcast is pure fire-and-forget and
        // must not hold the runner's PATCH open, which is hit on every item tick.
        // notifyInApp persists a local Notification and broadcasts it over the
        // customer's `notifications.{userId}` Reverb channel (replacing the old
        // realtime table insert) — broadcast-only, so a tick never fires a
        // device push. Same dispatch(fn)->afterResponse() pattern the SWR refresh
        // uses; values captured by value so the closure is request-independent.
        $customerId = $booking->customer_id;
        $bookingId = $booking->id;
        // The live message has a 10 KB ceiling (Reverb), and a long list of
        // long names went past it, so every tick's broadcast failed. A list
        // too big to carry is left out: the tracking screen keeps its last
        // copy and its regular refresh picks the ticks up.
        $liveItems = strlen((string) json_encode($items)) <= self::LIVE_ITEMS_MAX_BYTES ? $items : null;
        dispatch(function () use ($customerId, $bookingId, $liveItems) {
            // COALESCED: one live card per errand, not one per tick. This runs on
            // every item tick, so notifyInApp dropped 40 identical rows into the
            // customer's inbox for a 40-item list and buried everything that
            // needed attention. The broadcast — the part the tracking screen's
            // checklist actually consumes — is unchanged.
            app(\App\Services\NotificationService::class)->notifyInAppCoalesced(
                $customerId,
                'Shopping list updated',
                'Your runner updated the shopping checklist.',
                array_filter([
                    'type' => 'shopping_items_updated',
                    'booking_id' => $bookingId,
                    'shopping_items' => $liveItems,
                ], fn ($value) => $value !== null),
            );
        })->afterResponse();

        $booking->load(['errandType', 'runner', 'customer', 'statusLogs']);

        return response()->json([
            'data' => new BookingResource($booking),
            'message' => 'Shopping checklist updated.',
        ]);
    }
}
