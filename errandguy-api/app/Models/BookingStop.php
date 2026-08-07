<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * An additional destination on a multi-stop booking (see the booking_stops
 * migration). Ordered by {@see $sequence} after the booking's primary dropoff.
 */
class BookingStop extends Model
{
    use HasUuids;

    protected $keyType = 'string';
    public $incrementing = false;

    protected $fillable = [
        'booking_id',
        'sequence',
        'address',
        'lat',
        'lng',
        'contact_name',
        'contact_phone',
        'note',
        'completed_at',
    ];

    protected function casts(): array
    {
        return [
            'sequence' => 'integer',
            'lat' => 'decimal:7',
            'lng' => 'decimal:7',
            'completed_at' => 'datetime',
        ];
    }

    public function booking(): BelongsTo
    {
        return $this->belongsTo(Booking::class);
    }
}
