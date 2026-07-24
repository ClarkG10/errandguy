<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class RealtimeService
{
    private string $supabaseUrl;
    private string $serviceKey;

    public function __construct()
    {
        $this->supabaseUrl = config('services.supabase.url');
        $this->serviceKey = config('services.supabase.service_key');
    }

    public function broadcastBookingUpdate(string $bookingId, string $status, array $extra = []): void
    {
        $this->insertNotification(
            $this->getBookingCustomerId($bookingId),
            'Booking Update',
            "Your booking status changed to {$status}.",
            'booking_update',
            array_merge(['booking_id' => $bookingId, 'status' => $status], $extra)
        );
    }

    public function broadcastIncomingRequest(string $runnerId, array $bookingData): void
    {
        $this->insertNotification(
            $runnerId,
            'New Errand Request',
            'A new errand is available near you.',
            'booking_update',
            $bookingData
        );
    }

    public function broadcastSOSAlert(string $bookingId, string $userId, array $location): void
    {
        $this->insertNotification(
            $this->getBookingCounterpartId($bookingId, $userId),
            'SOS Alert',
            'An emergency alert has been triggered.',
            'sos',
            array_merge(['booking_id' => $bookingId], $location)
        );
    }

    public function insertNotification(
        string $userId,
        string $title,
        string $body,
        string $type,
        array $data = []
    ): void {
        try {
            $response = Http::withHeaders([
                'apikey' => $this->serviceKey,
                'Authorization' => "Bearer {$this->serviceKey}",
                'Content-Type' => 'application/json',
                'Prefer' => 'return=minimal',
            ])->post("{$this->supabaseUrl}/rest/v1/notifications", [
                'user_id' => $userId,
                'title' => $title,
                'body' => $body,
                'type' => $type,
                // Pass the array straight through: PostgREST serializes the
                // body once, so the jsonb `data` column stores a real object.
                // json_encode() here double-encoded it into a JSON *string*,
                // which broke the mobile app's deep-link routing (it reads
                // notification.data as an object, never JSON.parse-ing it).
                'data' => $data,
                'is_read' => false,
            ]);

            // Http does NOT throw on 4xx/5xx, so a Supabase reject (RLS /
            // malformed) would otherwise be dropped silently — the push never
            // lands and nothing is logged. Surface it.
            $this->logIfFailed($response, 'insert notification', ['user_id' => $userId]);
        } catch (\Throwable $e) {
            Log::error('RealtimeService: Failed to insert notification', [
                'user_id' => $userId,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Log a non-OK Supabase response (Http doesn't throw on 4xx/5xx by default,
     * so without this a failed insert/broadcast is silently dropped).
     */
    private function logIfFailed(\Illuminate\Http\Client\Response $response, string $op, array $context = []): void
    {
        if ($response->failed()) {
            Log::warning("RealtimeService: {$op} returned a non-OK status", array_merge($context, [
                'status' => $response->status(),
            ]));
        }
    }

    /**
     * Bulk-insert many notifications in a SINGLE PostgREST call.
     *
     * Broadcasting a negotiate offer to N nearby runners previously issued N
     * sequential HTTP round-trips (one insertNotification() per runner) inside
     * the booking-create request — latency scaled linearly with the number of
     * eligible runners, and a slow Supabase could stack N timeouts onto create.
     * PostgREST inserts an array body in one round-trip, so this stays O(1)
     * HTTP calls regardless of runner count while keeping the same sync model
     * (no queue-worker dependency).
     *
     * The `data` object is passed straight through (PostgREST serializes the
     * whole body once) so each row's jsonb `data` stays a real object — the
     * same reason insertNotification() must not json_encode() it.
     *
     * @param  array<int,array{user_id:string,title:string,body:string,type:string,data?:array<string,mixed>}>  $notifications
     * @return int  number of rows sent (0 if nothing to do or the call failed)
     */
    public function insertNotifications(array $notifications): int
    {
        if (empty($notifications)) {
            return 0;
        }

        $rows = array_map(fn ($n) => [
            'user_id' => $n['user_id'],
            'title' => $n['title'],
            'body' => $n['body'],
            'type' => $n['type'],
            'data' => $n['data'] ?? [],
            'is_read' => false,
        ], array_values($notifications));

        try {
            $response = Http::withHeaders([
                'apikey' => $this->serviceKey,
                'Authorization' => "Bearer {$this->serviceKey}",
                'Content-Type' => 'application/json',
                'Prefer' => 'return=minimal',
            ])->post("{$this->supabaseUrl}/rest/v1/notifications", $rows);

            if ($response->failed()) {
                $this->logIfFailed($response, 'bulk-insert notifications', ['count' => count($rows)]);

                return 0;
            }

            return count($rows);
        } catch (\Throwable $e) {
            Log::error('RealtimeService: Failed to bulk-insert notifications', [
                'count' => count($rows),
                'error' => $e->getMessage(),
            ]);

            return 0;
        }
    }

    public function broadcastRunnerLocation(string $bookingId, string $runnerId, array $coords): void
    {
        try {
            $response = Http::withHeaders([
                'apikey' => $this->serviceKey,
                'Authorization' => "Bearer {$this->serviceKey}",
                'Content-Type' => 'application/json',
                'Prefer' => 'return=minimal',
            ])->post("{$this->supabaseUrl}/rest/v1/runner_locations", [
                'booking_id' => $bookingId,
                'runner_id' => $runnerId,
                'lat' => $coords['lat'],
                'lng' => $coords['lng'],
                'heading' => $coords['heading'] ?? null,
                'speed' => $coords['speed'] ?? null,
                'accuracy' => $coords['accuracy'] ?? null,
            ]);

            $this->logIfFailed($response, 'insert runner location', ['booking_id' => $bookingId]);
        } catch (\Throwable $e) {
            Log::error('RealtimeService: Failed to insert runner location', [
                'booking_id' => $bookingId,
                'error' => $e->getMessage(),
            ]);
        }
    }

    public function broadcastChatMessage(string $bookingId, string $senderId, array $messageData): void
    {
        try {
            $response = Http::withHeaders([
                'apikey' => $this->serviceKey,
                'Authorization' => "Bearer {$this->serviceKey}",
                'Content-Type' => 'application/json',
                'Prefer' => 'return=minimal',
            ])->post("{$this->supabaseUrl}/rest/v1/messages", [
                'booking_id' => $bookingId,
                'sender_id' => $senderId,
                'content' => $messageData['content'] ?? null,
                'image_url' => $messageData['image_url'] ?? null,
                'is_system' => $messageData['is_system'] ?? false,
            ]);

            $this->logIfFailed($response, 'broadcast chat message', ['booking_id' => $bookingId]);
        } catch (\Throwable $e) {
            Log::error('RealtimeService: Failed to broadcast chat message', [
                'booking_id' => $bookingId,
                'error' => $e->getMessage(),
            ]);
        }
    }

    private function getBookingCustomerId(string $bookingId): string
    {
        return \App\Models\Booking::where('id', $bookingId)->value('customer_id') ?? '';
    }

    private function getBookingCounterpartId(string $bookingId, string $currentUserId): string
    {
        $booking = \App\Models\Booking::find($bookingId);
        if (!$booking) {
            return '';
        }

        return $currentUserId === $booking->customer_id
            ? ($booking->runner_id ?? '')
            : $booking->customer_id;
    }
}
