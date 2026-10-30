<?php

namespace App\Models;

use Filament\Auth\MultiFactor\App\Concerns\InteractsWithAppAuthentication;
use Filament\Auth\MultiFactor\App\Concerns\InteractsWithAppAuthenticationRecovery;
use Filament\Auth\MultiFactor\App\Contracts\HasAppAuthentication;
use Filament\Auth\MultiFactor\App\Contracts\HasAppAuthenticationRecovery;
use Filament\Auth\MultiFactor\Email\Concerns\InteractsWithEmailAuthentication;
use Filament\Auth\MultiFactor\Email\Contracts\HasEmailAuthentication;
use Filament\Models\Contracts\FilamentUser;
use Filament\Models\Contracts\HasName;
use Filament\Panel;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

/**
 * A staff member of the admin panel (/admin). Signing in takes a password and
 * a second step — an authenticator-app code or an emailed code — which every
 * role must set up (AdminPanelProvider). Super admins add staff, change roles
 * and disable accounts on the Staff page (StaffAccountService).
 */
class AdminUser extends Authenticatable implements FilamentUser, HasAppAuthentication, HasAppAuthenticationRecovery, HasEmailAuthentication, HasName
{
    use HasApiTokens, HasFactory, HasUuids, Notifiable;
    use InteractsWithAppAuthentication, InteractsWithAppAuthenticationRecovery, InteractsWithEmailAuthentication;

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

    /** What each role is for, as shown on the Staff page. */
    public const ROLE_LABELS = [
        self::ROLE_SUPER_ADMIN => 'Super admin — everything, including staff, settings and money',
        self::ROLE_ADMIN => 'Admin — people, errands, catalog, support and SOS, broadcasts, audit log (no money)',
        self::ROLE_FINANCE => 'Finance — payments, payouts and wallets; people and errands to look up',
        self::ROLE_SUPPORT => 'Support — support tickets and SOS; people and errands to look up',
        self::ROLE_OPS => 'Ops — support tickets, SOS, and acting on errands, accounts and runner approvals',
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

    // The two-step sign-in secrets are hidden (and encrypted) by the
    // InteractsWithAppAuthentication* traits.
    protected $hidden = [
        'password_hash',
        'two_factor_secret',
        'remember_token',
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

    public function hasTwoStepSignIn(): bool
    {
        return $this->twoStepMethod() !== null;
    }

    /** "App", "Email", "App + email", or null while two-step sign-in isn't set up. */
    public function twoStepMethod(): ?string
    {
        $methods = array_filter([
            filled($this->app_authentication_secret) ? 'App' : null,
            $this->has_email_authentication ? 'Email' : null,
        ]);

        return $methods === [] ? null : implode(' + ', $methods);
    }

    /**
     * May export lists holding people's phone numbers, email addresses or
     * wallet balances to CSV.
     */
    public function canExportPersonalData(): bool
    {
        return $this->hasAnyRole(self::ROLE_SUPER_ADMIN, self::ROLE_ADMIN);
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
     * May act on support/safety surfaces (support tickets, SOS).
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
     * May moderate accounts/errands and verify runners (user suspend/unsuspend,
     * booking cancel, runner approve/reject). Distinct from canHandleSupport:
     * moderation EXCLUDES support (support handles tickets/SOS but not
     * account/booking moderation), mirroring the Filament Users/Bookings/
     * RunnerProfiles action gates (hasAnyRole super_admin/admin/ops).
     */
    public function canModerate(): bool
    {
        return $this->hasAnyRole(
            self::ROLE_SUPER_ADMIN,
            self::ROLE_ADMIN,
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
