<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Booking extends Model
{
    use HasUuids;

    protected $keyType = 'string';
    public $incrementing = false;

    /**
     * Attributes hidden from array/JSON serialization.
     * ride_pin and trip_share_token are secrets — only exposed conditionally via BookingResource.
     */
    protected $hidden = [
        'ride_pin',
        'trip_share_token',
    ];

    protected $fillable = [
        'booking_number',
        'customer_id',
        'runner_id',
        'errand_type_id',
        'status',
        'pickup_address',
        'pickup_lat',
        'pickup_lng',
        'pickup_contact_name',
        'pickup_contact_phone',
        'dropoff_address',
        'dropoff_lat',
        'dropoff_lng',
        'dropoff_contact_name',
        'dropoff_contact_phone',
        'description',
        'special_instructions',
        'item_photos',
        'estimated_item_value',
        'shopping_budget',
        'shopping_items',
        'actual_item_cost',
        'receipt_photo_url',
        'schedule_type',
        'scheduled_at',
        'pricing_mode',
        'vehicle_type_rate',
        'distance_km',
        'base_fee',
        'distance_fee',
        'service_fee',
        'surcharge',
        'promo_discount',
        'total_amount',
        'payment_method',
        'payment_status',
        'customer_offer',
        'recommended_min',
        'recommended_max',
        'runner_payout',
        'tip_amount',
        'negotiate_expires_at',
        'pickup_photo_url',
        'delivery_photo_url',
        'signature_url',
        'matched_at',
        'accepted_at',
        'picked_up_at',
        'completed_at',
        'cancelled_at',
        'cancellation_reason',
        'cancellation_fee',
        'cancelled_by',
        'promo_code_id',
        'promo_redeemed',
        'ride_pin',
        'ride_pin_verified',
        'is_transportation',
        'sos_triggered',
        'trip_share_token',
        'trip_share_active',
        'trip_share_expires_at',
    ];

    protected function casts(): array
    {
        return [
            'item_photos' => 'array',
            'shopping_items' => 'array',
            'is_transportation' => 'boolean',
            'promo_redeemed' => 'boolean',
            'sos_triggered' => 'boolean',
            'trip_share_active' => 'boolean',
            'trip_share_expires_at' => 'datetime',
            'ride_pin_verified' => 'boolean',
            'total_amount' => 'decimal:2',
            'base_fee' => 'decimal:2',
            'distance_fee' => 'decimal:2',
            'service_fee' => 'decimal:2',
            'surcharge' => 'decimal:2',
            'promo_discount' => 'decimal:2',
            'cancellation_fee' => 'decimal:2',
            'customer_offer' => 'decimal:2',
            'runner_payout' => 'decimal:2',
            'tip_amount' => 'decimal:2',
            'distance_km' => 'decimal:2',
            'shopping_budget' => 'decimal:2',
            'actual_item_cost' => 'decimal:2',
            'pickup_lat' => 'decimal:7',
            'pickup_lng' => 'decimal:7',
            'dropoff_lat' => 'decimal:7',
            'dropoff_lng' => 'decimal:7',
            'scheduled_at' => 'datetime',
            'negotiate_expires_at' => 'datetime',
            'matched_at' => 'datetime',
            'accepted_at' => 'datetime',
            'picked_up_at' => 'datetime',
            'completed_at' => 'datetime',
            'cancelled_at' => 'datetime',
        ];
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'customer_id');
    }

    public function runner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'runner_id');
    }

    public function errandType(): BelongsTo
    {
        return $this->belongsTo(ErrandType::class);
    }

    public function statusLogs(): HasMany
    {
        // Default ordering so every consumer (BookingResource, polling
        // /track, /show, /current) gets a chronologically-stable list
        // without each call paying for an in-memory sort. Composite
        // index idx_status_logs_booking_created supports this directly.
        return $this->hasMany(BookingStatusLog::class)->orderBy('created_at');
    }

    public function messages(): HasMany
    {
        return $this->hasMany(Message::class);
    }

    public function runnerLocations(): HasMany
    {
        return $this->hasMany(RunnerLocation::class);
    }

    public function payment(): HasOne
    {
        return $this->hasOne(Payment::class);
    }

    /**
     * All reviews on this booking. Reviews are bidirectional — the customer
     * rates the runner AND the runner rates the customer — so a completed
     * booking can hold up to two rows, keyed by reviewer_id.
     */
    public function reviews(): HasMany
    {
        return $this->hasMany(Review::class);
    }

    /**
     * The customer's review of the runner — the canonical "review of this
     * booking" for existing clients. Scoped to reviewer_id = customer_id so
     * it is deterministic; the old unscoped hasOne returned an arbitrary row
     * once the runner had also left a review.
     */
    public function review(): HasOne
    {
        return $this->hasOne(Review::class)
            ->whereColumn('reviewer_id', 'customer_id');
    }

    /**
     * The runner's review of the customer.
     */
    public function runnerReview(): HasOne
    {
        return $this->hasOne(Review::class)
            ->whereColumn('reviewer_id', 'runner_id');
    }

    public function promoCode(): BelongsTo
    {
        return $this->belongsTo(PromoCode::class, 'promo_code_id');
    }

    public function scopeActive($query)
    {
        return $query->whereNotIn('status', ['completed', 'cancelled']);
    }

    public function scopeCompleted($query)
    {
        return $query->where('status', 'completed');
    }

    public function scopeCancelled($query)
    {
        return $query->where('status', 'cancelled');
    }

    public function scopeForCustomer($query, string $userId)
    {
        return $query->where('customer_id', $userId);
    }

    public function scopeForRunner($query, string $userId)
    {
        return $query->where('runner_id', $userId);
    }
}
