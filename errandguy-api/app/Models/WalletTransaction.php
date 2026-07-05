<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class WalletTransaction extends Model
{
    use HasUuids;

    protected $keyType = 'string';
    public $incrementing = false;
    public $timestamps = false;

    protected $fillable = [
        'user_id',
        'type',
        'amount',
        'balance_after',
        'reference_id',
        'gateway_ref',
        'checkout_url',
        'description',
        'status',
        'processed_at',
        'failure_reason',
    ];

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
            'balance_after' => 'decimal:2',
            'created_at' => 'datetime',
            'processed_at' => 'datetime',
        ];
    }

    /**
     * Attributes appended to JSON output. Letting these flow through the
     * API saves the mobile client from re-implementing the same humanise
     * logic for both customer and runner wallet screens.
     */
    protected $appends = ['display_description'];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Booking referenced by this transaction (only meaningful for
     * payment/earning/refund types where reference_id stores a booking
     * UUID). The relation lazily resolves to null otherwise.
     */
    public function booking(): BelongsTo
    {
        return $this->belongsTo(Booking::class, 'reference_id');
    }

    /**
     * Customer-facing description.
     *
     * The raw `description` column was historically written as terse
     * dev-strings ("Payment for booking 7f3c-...", "Wallet top-up").
     * That made the wallet ledger feel auto-generated and leaked UUIDs.
     *
     * This accessor produces a friendlier label using the related
     * Booking + ErrandType when available, falling back to the
     * existing description when nothing better can be derived. We do
     * NOT mutate the stored column so historical audit trails stay
     * intact; the original is still exposed as `description`.
     */
    public function getDisplayDescriptionAttribute(): string
    {
        $brand = 'ErrandGuy';

        // Booking-linked types: enrich with errand type + booking #.
        if (in_array($this->type, ['payment', 'earning', 'refund'], true) && $this->reference_id) {
            // Avoid an N+1 here: callers are expected to eager-load
            // booking.errandType when they care about display labels.
            // If the relation isn't loaded, we issue at most one cheap
            // single-row lookup rather than crash.
            $booking = $this->relationLoaded('booking')
                ? $this->getRelation('booking')
                : Booking::with('errandType')->find($this->reference_id);

            if ($booking) {
                $typeName = optional($booking->errandType)->name ?? 'Errand';
                $shortNumber = $booking->booking_number ?? substr((string) $booking->id, 0, 8);
                $verb = match ($this->type) {
                    'payment' => 'Paid for',
                    'earning' => 'Earned from',
                    'refund' => 'Refund for',
                };
                return "{$brand} · {$verb} {$typeName} #{$shortNumber}";
            }
        }

        return match ($this->type) {
            'top_up' => "{$brand} · Wallet top-up",
            'payout' => "{$brand} · Payout to bank or e-wallet",
            'bonus' => "{$brand} · Promotional bonus",
            default => $this->description ?? ucfirst(str_replace('_', ' ', (string) $this->type)),
        };
    }
}

