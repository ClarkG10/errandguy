<?php

namespace App\Http\Controllers;

use App\Models\Booking;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

/**
 * Serves booking-scoped media (chat images, runner completion proofs incl.
 * receipt photos, customer item photos) from the PRIVATE 'media' disk. These
 * used to live on the public disk and were reachable by URL alone — receipt
 * photos reveal what/where a customer purchased and chat images are arbitrary
 * user content. Every read now goes through this authorized endpoint.
 *
 * Paths are always "{chat-images|booking-photos}/{bookingId}/{file}", so the
 * booking is derivable from the path and access is granted to a participant of
 * that booking (customer or runner, via their sanctum bearer) or to an admin
 * (Filament session). The route is single, dual-guard, so one stored URL serves
 * both the app and the admin panel.
 */
class BookingMediaController extends Controller
{
    /**
     * Store an upload on the private media disk and return the authorized URL to
     * persist on the row (replaces the old Storage::disk('public')->url()).
     */
    public static function storeAndUrl(UploadedFile $file, string $dir): string
    {
        $path = $file->store($dir, 'media');

        return route('booking.media', ['path' => $path]);
    }

    public function show(Request $request, string $path)
    {
        // Lock the served path to the two media dirs + a UUID booking segment +
        // a safe filename — closes path traversal and arbitrary reads.
        abort_unless(
            preg_match('#^(chat-images|booking-photos)/[0-9a-fA-F-]{36}/[A-Za-z0-9._-]+$#', $path) === 1,
            404,
        );

        $bookingId = explode('/', $path)[1];
        $booking = Booking::find($bookingId);
        abort_if($booking === null, 404);

        // An admin (Filament session OR an admin sanctum token) OR a participant
        // of the booking (customer / runner, via their sanctum bearer) may view it.
        $user = auth('sanctum')->user();
        $isAdmin = auth('admin')->check() || $user instanceof \App\Models\AdminUser;
        $isParticipant = $user !== null
            && ! ($user instanceof \App\Models\AdminUser)
            && in_array($user->id, [$booking->customer_id, $booking->runner_id], true);

        abort_unless($isAdmin || $isParticipant, 403);
        abort_unless(Storage::disk('media')->exists($path), 404);

        return Storage::disk('media')->response($path);
    }
}
