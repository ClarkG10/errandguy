<?php

namespace App\Events;

use App\Models\RunnerLocation;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * Broadcasts a runner's live position to the customer tracking the booking.
 * Replaces the Supabase `runner_locations` subscription. This is the one
 * latency-critical stream (the moving map pin), so it broadcasts synchronously
 * (ShouldBroadcastNow) rather than via the queue — the dispatch site wraps it
 * in a try/catch so a Reverb hiccup can never fail a location ping.
 */
class RunnerLocationUpdated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public RunnerLocation $location,
    ) {}

    public function broadcastOn(): PrivateChannel
    {
        return new PrivateChannel('booking.' . $this->location->booking_id);
    }

    public function broadcastAs(): string
    {
        return 'runner.location';
    }

    /**
     * lat/lng/heading/speed are Eloquent `decimal` casts, which serialize as
     * STRINGS. The mobile map marker needs NUMBERS (Supabase's WAL feed
     * delivered numerics); without these explicit float casts the pin silently
     * freezes. `RunnerLocation` type on the client expects number | null.
     */
    public function broadcastWith(): array
    {
        return [
            'id' => $this->location->id,
            'booking_id' => $this->location->booking_id,
            'runner_id' => $this->location->runner_id,
            'lat' => (float) $this->location->lat,
            'lng' => (float) $this->location->lng,
            'heading' => $this->location->heading !== null ? (float) $this->location->heading : null,
            'speed' => $this->location->speed !== null ? (float) $this->location->speed : null,
            'accuracy' => $this->location->accuracy !== null ? (float) $this->location->accuracy : null,
            // timestamps=false + a DB-default created_at means the just-created,
            // un-refreshed model has no created_at in memory (broadcasts null),
            // yet the mobile RunnerLocation.created_at is a non-null string.
            // Fall back to now() — this fires within ms of the insert.
            'created_at' => ($this->location->created_at ?? now())->toIso8601String(),
        ];
    }
}
