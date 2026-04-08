<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    use HasApiTokens, HasFactory, HasUuids, SoftDeletes;

    protected $keyType = 'string';
    public $incrementing = false;

    protected $fillable = [
        'phone',
        'email',
        'password_hash',
        'full_name',
        'avatar_url',
        'role',
        'status',
        'email_verified',
        'phone_verified',
        'default_lat',
        'default_lng',
        'fcm_token',
        'wallet_balance',
        'avg_rating',
        'total_ratings',
        'last_active_at',
    ];

    protected $hidden = [
        'password_hash',
        'fcm_token',
    ];

    protected function casts(): array
    {
        return [
            'email_verified' => 'boolean',
            'phone_verified' => 'boolean',
            'wallet_balance' => 'decimal:2',
            'avg_rating' => 'decimal:2',
            'default_lat' => 'decimal:7',
            'default_lng' => 'decimal:7',
            'last_active_at' => 'datetime',
            'deleted_at' => 'datetime',
        ];
    }

    public function getAuthPassword(): string
    {
        return $this->password_hash;
    }

    public function runnerProfile(): HasOne
    {
        return $this->hasOne(RunnerProfile::class);
    }

    public function customerBookings(): HasMany
    {
        return $this->hasMany(Booking::class, 'customer_id');
    }

    public function runnerBookings(): HasMany
    {
        return $this->hasMany(Booking::class, 'runner_id');
    }

    public function paymentMethods(): HasMany
    {
        return $this->hasMany(PaymentMethod::class);
    }

    public function walletTransactions(): HasMany
    {
        return $this->hasMany(WalletTransaction::class);
    }

    public function savedAddresses(): HasMany
    {
        return $this->hasMany(SavedAddress::class);
    }

    public function trustedContacts(): HasMany
    {
        return $this->hasMany(TrustedContact::class);
    }

    public function notifications(): HasMany
    {
        return $this->hasMany(Notification::class);
    }

    public function reviews(): HasMany
    {
        return $this->hasMany(Review::class, 'reviewee_id');
    }

    public function scopeActive($query)
    {
        return $query->where('status', 'active');
    }

    public function scopeCustomers($query)
    {
        return $query->where('role', 'customer');
    }

    public function scopeRunners($query)
    {
        return $query->where('role', 'runner');
    }
}
