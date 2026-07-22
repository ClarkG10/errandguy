<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use App\Services\ReferralService;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
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
        'suspended_reason',
        'suspended_at',
        'email_verified',
        'phone_verified',
        'default_lat',
        'default_lng',
        'fcm_token',
        'wallet_balance',
        'xendit_customer_id',
        'avg_rating',
        'total_ratings',
        'last_active_at',
        'referral_code',
        'referred_by',
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
            'suspended_at' => 'datetime',
            'deleted_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        // Every user gets a unique referral code at creation time so the
        // referral program works without a backfill step for new accounts.
        static::creating(function (User $user) {
            if (empty($user->referral_code)) {
                $user->referral_code = app(ReferralService::class)->generateCode();
            }
        });
    }

    public function getAuthPassword(): string
    {
        return $this->password_hash;
    }

    public function runnerProfile(): HasOne
    {
        return $this->hasOne(RunnerProfile::class);
    }

    /**
     * KYC documents belong to the runner PROFILE (runner_documents.runner_id =
     * runner_profiles.id), so reaching them from a user goes through the
     * profile. Lets admin screens eager-load ->with('runnerDocuments').
     */
    public function runnerDocuments(): \Illuminate\Database\Eloquent\Relations\HasManyThrough
    {
        return $this->hasManyThrough(
            RunnerDocument::class,
            RunnerProfile::class,
            'user_id',   // FK on runner_profiles -> users
            'runner_id', // FK on runner_documents -> runner_profiles
            'id',        // local key on users
            'id',        // local key on runner_profiles
        );
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

    /**
     * Referrals where this user is the referrer (people they invited).
     */
    public function referralsMade(): HasMany
    {
        return $this->hasMany(Referral::class, 'referrer_id');
    }

    /**
     * The user who referred this user, if any.
     */
    public function referredBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'referred_by');
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
