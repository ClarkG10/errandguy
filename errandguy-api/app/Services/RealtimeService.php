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
            Http::withHeaders([
                'apikey' => $this->serviceKey,
                'Authorization' => "Bearer {$this->serviceKey}",
                'Content-Type' => 'application/json',
                'Prefer' => 'return=minimal',
            ])->post("{$this->supabaseUrl}/rest/v1/notifications", [
                'user_id' => $userId,
                'title' => $title,
                'body' => $body,
                'type' => $type,
                'data' => json_encode($data),
                'is_read' => false,
            ]);
        } catch (\Throwable $e) {
            Log::error('RealtimeService: Failed to insert notification', [
                'user_id' => $userId,
                'error' => $e->getMessage(),
            ]);
        }
    }

    public function broadcastRunnerLocation(string $bookingId, string $runnerId, array $coords): void
    {
        try {
            Http::withHeaders([
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
            Http::withHeaders([
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
