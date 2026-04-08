<?php

namespace App\Events;

use App\Models\Booking;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class RideDurationAlert
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public Booking $booking,
        public int $elapsedMinutes,
        public int $estimatedMinutes,
    ) {}
}
