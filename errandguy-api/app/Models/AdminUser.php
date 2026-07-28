<?php

namespace App\Models;

use Filament\Models\Contracts\FilamentUser;
use Filament\Models\Contracts\HasName;
use Filament\Panel;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Laravel\Sanctum\HasApiTokens;

class AdminUser extends Authenticatable implements FilamentUser, HasName
{
    use HasApiTokens, HasFactory, HasUuids;

    /**
     * Admin role vocabulary. The `role` column is a free string in the DB
     * (default `admin`); these constants define the values the panel expects.
     * Access to money/system surfaces is gated on these (see AdminPanelProvider
     * resources' canViewAny()).
     */
    public const ROLE_SUPER_ADMIN = 'super_admin';
    public const ROLE_ADMIN = 'admin';
    public const ROLE_FINANCE = 'finance';
    public const ROLE_SUPPORT = 'support';
    public const ROLE_OPS = 'ops';

    public const ROLES = [
        self::ROLE_SUPER_ADMIN,
        self::ROLE_ADMIN,
        self::ROLE_FINANCE,
        self::ROLE_SUPPORT,
        self::ROLE_OPS,
    ];

    protected $keyType = 'string';
    public $incrementing = false;

    protected $fillable = [
        'email',
        'password_hash',
        'full_name',
        'role',
        'is_active',
        'last_login_at',
    ];

    protected $hidden = [
        'password_hash',
        'two_factor_secret',
    ];

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
            'last_login_at' => 'datetime',
        ];
    }

    public function getAuthPassword(): string
    {
        return $this->password_hash;
    }

    /**
     * The column that stores the password. Laravel 11+ rehashes the password on
     * every successful login and writes it to THIS column; the framework default
     * is `password`, but ours is `password_hash` (without this override the
     * post-login rehash does `update admin_users set password = ...` and 500s
     * with "column password does not exist").
     */
    public function getAuthPasswordName(): string
    {
        return 'password_hash';
    }

    /**
     * Filament: which authenticated users may enter the panel.
     * Required in production. Active admins with a recognised role only.
     */
    public function canAccessPanel(Panel $panel): bool
    {
        return $this->is_active && in_array($this->role, self::ROLES, true);
    }

    /**
     * Filament: label shown in the user menu (model has full_name, not name).
     */
    public function getFilamentName(): string
    {
        return $this->full_name ?: $this->email;
    }

    // --- Role helpers (used by resource/page authorization) ---

    public function hasRole(string $role): bool
    {
        return $this->role === $role;
    }

    public function hasAnyRole(string ...$roles): bool
    {
        return in_array($this->role, $roles, true);
    }

    public function isSuperAdmin(): bool
    {
        return $this->hasRole(self::ROLE_SUPER_ADMIN);
    }

    /**
     * May act on money surfaces (payments/refunds, payouts, wallet,
     * platform payment methods).
     */
    public function canManageMoney(): bool
    {
        return $this->hasAnyRole(self::ROLE_SUPER_ADMIN, self::ROLE_FINANCE);
    }

    /**
     * May act on support/safety surfaces (disputes, support tickets, SOS).
     */
    public function canHandleSupport(): bool
    {
        return $this->hasAnyRole(
            self::ROLE_SUPER_ADMIN,
            self::ROLE_ADMIN,
            self::ROLE_SUPPORT,
            self::ROLE_OPS,
        );
    }

    /**
     * May change platform-wide system configuration.
     */
    public function canManageSystem(): bool
    {
        return $this->hasRole(self::ROLE_SUPER_ADMIN);
    }
}
