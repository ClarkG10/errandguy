<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Facades\Crypt;

class RunnerProfile extends Model
{
    use HasUuids;

    protected $keyType = 'string';
    public $incrementing = false;

    protected $fillable = [
        'user_id',
        'verification_status',
        'vehicle_type',
        'vehicle_plate',
        'vehicle_photo_url',
        'is_online',
        'current_lat',
        'current_lng',
        'last_location_at',
        'acceptance_rate',
        'completion_rate',
        'total_errands',
        'total_earnings',
        'preferred_types',
        'working_area_lat',
        'working_area_lng',
        'working_area_radius',
        'bank_name',
        'bank_account_number',
        'ewallet_number',
        'payout_channel_code',
        'approved_at',
    ];

    protected $hidden = [
        'bank_account_number',
    ];

    protected function casts(): array
    {
        return [
            'is_online' => 'boolean',
            'preferred_types' => 'array',
            'total_earnings' => 'decimal:2',
            'acceptance_rate' => 'decimal:2',
            'completion_rate' => 'decimal:2',
            'current_lat' => 'decimal:7',
            'current_lng' => 'decimal:7',
            'last_location_at' => 'datetime',
            'approved_at' => 'datetime',
        ];
    }

    public function setBankAccountNumberAttribute($value): void
    {
        $this->attributes['bank_account_number'] = $value ? Crypt::encryptString($value) : null;
    }

    public function getBankAccountNumberAttribute($value): ?string
    {
        return $value ? Crypt::decryptString($value) : null;
    }

    /**
     * Last 4 digits of the saved bank account — computed at read, never stored.
     *
     * The full number is encrypted at rest and $hidden, so the payout screen's
     * account field renders empty forever and runners cannot tell whether an
     * account is already on file (they re-type it "just in case" every visit,
     * and can't spot a typo in the one they saved). This is the smallest honest
     * confirmation: "•••• 1234 on file". NOTHING wider than the last 4 digits
     * is ever exposed, and this is not $appends'd — RunnerProfileResource emits
     * it only for the owning runner.
     */
    public function getBankAccountLast4Attribute(): ?string
    {
        try {
            $number = $this->bank_account_number;
        } catch (\Throwable) {
            // A legacy row written before the Crypt setter holds plaintext and
            // throws on decrypt. Read as "nothing on file" rather than a 500.
            return null;
        }

        $digits = preg_replace('/\D/', '', (string) $number) ?? '';

        return strlen($digits) >= 4 ? substr($digits, -4) : null;
    }

    /** True when a payout could actually be sent to the saved bank details. */
    public function hasStoredBankAccountNumber(): bool
    {
        // Read the RAW column so a legacy/undecryptable value still counts as
        // "on file" (the accessor would throw / mask it as absent).
        return filled($this->getRawOriginal('bank_account_number'));
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function documents(): HasMany
    {
        return $this->hasMany(RunnerDocument::class, 'runner_id');
    }

    /** Errands this runner has taken (bookings.runner_id → users.id → this profile's user_id). */
    public function bookings(): HasMany
    {
        return $this->hasMany(Booking::class, 'runner_id', 'user_id');
    }

    public function scopeOnline($query)
    {
        return $query->where('is_online', true);
    }

    public function scopeApproved($query)
    {
        return $query->where('verification_status', 'approved');
    }

    public function scopePending($query)
    {
        return $query->where('verification_status', 'pending');
    }
}
