<?php

use App\Models\Booking;
use App\Models\User;
use Illuminate\Support\Facades\Broadcast;

/*
| Broadcast channel authorization.
|
| These callbacks run behind POST /broadcasting/auth (registered in
| bootstrap/app.php under the `auth:sanctum` guard), so `$user` is the
| bearer-token-authenticated User. IDs are UUID strings — compare with
| (string) casts and ===, never the framework's default (int) stub, which
| would coerce every UUID to 0 and authorize everyone onto everyone's channel.
*/

/**
 * A single user's private notification stream.
 * Mirrors the per-user scoping the notifications REST endpoints already apply.
 */
Broadcast::channel('notifications.{userId}', function (User $user, string $userId) {
    return (string) $user->id === (string) $userId;
});

/**
 * A runner's incoming-offer stream (the "you've been matched" popup).
 * Only the runner themselves, and only while acting in the runner role.
 */
Broadcast::channel('runner.{runnerId}', function (User $user, string $runnerId) {
    return (string) $user->id === (string) $runnerId && $user->role === 'runner';
});

/**
 * Per-booking status + live runner-location stream. Authorized to either
 * participant — the exact predicate ChatController::authorizeBookingParticipant
 * enforces on the REST side.
 */
Broadcast::channel('booking.{bookingId}', function (User $user, string $bookingId) {
    $booking = Booking::find($bookingId);

    return $booking
        && ((string) $user->id === (string) $booking->customer_id
            || (string) $user->id === (string) $booking->runner_id);
});

/**
 * Per-booking chat stream (messages + typing whispers). Same participant
 * predicate as the booking channel; kept separate so its subscription
 * lifecycle matches the chat screen, not the tracking screen.
 */
Broadcast::channel('chat.{bookingId}', function (User $user, string $bookingId) {
    $booking = Booking::find($bookingId);

    return $booking
        && ((string) $user->id === (string) $booking->customer_id
            || (string) $user->id === (string) $booking->runner_id);
});
