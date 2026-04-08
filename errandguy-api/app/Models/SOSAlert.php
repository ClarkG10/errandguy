<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SOSAlert extends Model
{
    use HasUuids;

    protected $table = 'sos_alerts';
    protected $keyType = 'string';
    public $incrementing = false;
    public $timestamps = false;

    protected $fillable = [
        'booking_id',
        'customer_id',
        'runner_id',
        'triggered_at',
        'customer_lat',
        'customer_lng',
        'runner_lat',
        'runner_lng',
        'contacts_notified',
        'live_link_token',
        'live_link_expires_at',
        'resolved_at',
        'resolution_note',
        'status',
    ];

    protected function casts(): array
    {
        return [
            'contacts_notified' => 'array',
            'customer_lat' => 'decimal:7',
            'customer_lng' => 'decimal:7',
            'runner_lat' => 'decimal:7',
            'runner_lng' => 'decimal:7',
            'triggered_at' => 'datetime',
            'live_link_expires_at' => 'datetime',
            'resolved_at' => 'datetime',
            'created_at' => 'datetime',
        ];
    }

    public function booking(): BelongsTo
    {
        return $this->belongsTo(Booking::class);
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'customer_id');
    }

    public function runner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'runner_id');
    }
}
