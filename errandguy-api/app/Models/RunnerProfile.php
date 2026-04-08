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

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function documents(): HasMany
    {
        return $this->hasMany(RunnerDocument::class, 'runner_id');
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
