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
        'triggered_by',
        'triggered_by_role',
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
        'trigger_lat',
        'trigger_lng',
        'trigger_accuracy_m',
        'trigger_location_source',
        'resolved_by',
        'resolved_by_type',
    ];

    /** Open: nobody has closed it yet. */
    public const STATUS_ACTIVE = 'active';

    /** Closed by ErrandGuy staff, or automatically by the system. */
    public const STATUS_RESOLVED = 'resolved';

    /** Called off by the person who raised it. */
    public const STATUS_CANCELLED = 'cancelled';

    /** Where trigger_lat/lng came from. */
    public const LOCATION_DEVICE = 'device';

    public const LOCATION_RUNNER_LAST_KNOWN = 'runner_last_known';

    public const LOCATION_ERRAND_POINT = 'errand_point';

    protected function casts(): array
    {
        return [
            'contacts_notified' => 'array',
            'customer_lat' => 'decimal:7',
            'customer_lng' => 'decimal:7',
            'runner_lat' => 'decimal:7',
            'runner_lng' => 'decimal:7',
            'trigger_lat' => 'decimal:7',
            'trigger_lng' => 'decimal:7',
            'trigger_accuracy_m' => 'decimal:1',
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

    /** The person who pressed SOS. */
    public function triggeredBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'triggered_by');
    }

    /** Google Maps link to where the person who pressed SOS is, or null. */
    public function triggerMapUrl(): ?string
    {
        if ($this->trigger_lat === null || $this->trigger_lng === null) {
            return null;
        }

        return 'https://www.google.com/maps?q='.$this->trigger_lat.','.$this->trigger_lng;
    }

    /** Plain-words description of where trigger_lat/lng came from. */
    public function triggerLocationLabel(): string
    {
        return match ($this->trigger_location_source) {
            self::LOCATION_DEVICE => 'Their phone’s GPS when they pressed SOS'
                .($this->trigger_accuracy_m !== null ? ' (within about '.(int) round((float) $this->trigger_accuracy_m).' m)' : ''),
            self::LOCATION_RUNNER_LAST_KNOWN => 'The runner’s last known location (the phone sent no GPS)',
            self::LOCATION_ERRAND_POINT => 'The errand’s address (the phone sent no GPS)',
            default => 'Unknown',
        };
    }

    /** Who closed the alert, in plain words, or null while it is open. */
    public function closedByLabel(): ?string
    {
        if ($this->status === self::STATUS_ACTIVE) {
            return null;
        }

        return match ($this->resolved_by_type) {
            'customer' => 'The customer who raised it',
            'runner' => 'The runner who raised it',
            'admin' => 'ErrandGuy staff'
                .(($name = AdminUser::whereKey($this->resolved_by)->value('full_name')) ? ' ('.$name.')' : ''),
            'system' => 'Closed automatically',
            default => null,
        };
    }
}
