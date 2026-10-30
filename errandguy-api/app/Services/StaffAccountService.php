<?php

namespace App\Services;

use App\Exceptions\StaffAccountException;
use App\Models\AdminUser;
use App\Notifications\StaffPasswordLink;
use App\Support\AdminActivity;
use App\Support\StaffSignIn;
use Filament\Facades\Filament;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Str;

/**
 * Super-admin management of staff accounts (the Staff page). Every change is
 * written to the `admin` audit log.
 *
 * New staff are added without a password anyone knows: they get an email
 * with a link to choose one (the staff `admins` password broker), and set up
 * two-step sign-in the first time they sign in. `errandguy:make-admin` still
 * creates or resets an account from the server.
 *
 * The panel always keeps at least one active super admin, and nobody can
 * disable or demote themselves.
 */
class StaffAccountService
{
    /** Add a staff member; follow with sendSetPasswordLink($staff, isInvite: true). */
    public function invite(string $fullName, string $email, string $role): AdminUser
    {
        $this->assertRole($role);
        $email = Str::lower(trim($email));

        if (AdminUser::where('email', $email)->exists()) {
            throw new StaffAccountException('A staff account with this email already exists.');
        }

        $staff = AdminUser::create([
            'full_name' => trim($fullName),
            'email' => $email,
            'role' => $role,
            // Nobody knows this password; the staff member sets their own
            // from the emailed link.
            'password_hash' => Hash::make(Str::random(64)),
            'is_active' => true,
        ]);

        AdminActivity::log('staff.added', $staff, ['email' => $email, 'role' => $role], "Added staff member {$email}");

        return $staff;
    }

    /** Email a link to choose a (new) password. Doesn't change the current one. */
    public function sendSetPasswordLink(AdminUser $staff, bool $isInvite = false): void
    {
        if (! $staff->is_active) {
            throw new StaffAccountException('Enable this account before sending a set-password email.');
        }

        $token = Password::broker('admins')->createToken($staff);

        $notification = new StaffPasswordLink($token, $isInvite);
        $notification->url = Filament::getPanel('admin')->getResetPasswordUrl($token, $staff);
        $staff->notify($notification);

        if (! $isInvite) {
            AdminActivity::log('staff.password_link_sent', $staff, ['email' => $staff->email], "Sent a set-password email to {$staff->email}");
        }
    }

    public function changeRole(AdminUser $by, AdminUser $staff, string $role): void
    {
        $this->assertRole($role);

        if ($staff->role === $role) {
            return;
        }
        if ($staff->is($by)) {
            throw new StaffAccountException('You can’t change your own role. Ask another super admin.');
        }

        $old = $staff->role;

        DB::transaction(function () use ($staff, $role): void {
            if ($staff->isSuperAdmin()) {
                $this->assertAnotherActiveSuperAdmin($staff);
            }

            $staff->update(['role' => $role]);
        });

        AdminActivity::log('staff.role_changed', $staff, [
            'email' => $staff->email,
            'old' => $old,
            'new' => $role,
        ], "Changed {$staff->email}'s role from {$old} to {$role}");
    }

    /**
     * Disable an account: it can't sign in, and any open session ends on its
     * next request (AuthenticateStaff). A new remember token voids any
     * "keep me signed in" cookie.
     */
    public function disable(AdminUser $by, AdminUser $staff, string $reason): void
    {
        if ($staff->is($by)) {
            throw new StaffAccountException('You can’t disable your own account.');
        }
        if (! $staff->is_active) {
            return;
        }

        DB::transaction(function () use ($staff): void {
            if ($staff->isSuperAdmin()) {
                $this->assertAnotherActiveSuperAdmin($staff);
            }

            $staff->forceFill([
                'is_active' => false,
                'remember_token' => Str::random(60),
            ])->save();
        });

        AdminActivity::log('staff.disabled', $staff, ['email' => $staff->email, 'reason' => trim($reason)], "Disabled staff member {$staff->email}");
    }

    public function enable(AdminUser $staff): void
    {
        if ($staff->is_active) {
            return;
        }

        $staff->forceFill(['is_active' => true])->save();

        AdminActivity::log('staff.enabled', $staff, ['email' => $staff->email], "Enabled staff member {$staff->email}");
    }

    /**
     * Clear a staff member's two-step sign-in (a lost phone, say). They set
     * it up again right after their next password sign-in.
     */
    public function resetTwoStep(AdminUser $by, AdminUser $staff): void
    {
        if ($staff->is($by)) {
            throw new StaffAccountException('Manage your own two-step sign-in on My account.');
        }

        $staff->forceFill([
            'app_authentication_secret' => null,
            'app_authentication_recovery_codes' => null,
            'has_email_authentication' => false,
            'remember_token' => Str::random(60),
        ])->save();

        AdminActivity::log('staff.two_step_reset', $staff, ['email' => $staff->email], "Reset two-step sign-in for {$staff->email}");
    }

    /** Lift the 15-minute sign-in lock after too many failed attempts. */
    public function unlockSignIn(AdminUser $staff): void
    {
        StaffSignIn::unlock($staff->email);

        AdminActivity::log('staff.sign_in_unlocked', $staff, ['email' => $staff->email], "Unlocked sign-in for {$staff->email}");
    }

    private function assertRole(string $role): void
    {
        if (! in_array($role, AdminUser::ROLES, true)) {
            throw new StaffAccountException('Choose one of the staff roles.');
        }
    }

    /** Locks the super-admin rows so two simultaneous changes can't both pass. */
    private function assertAnotherActiveSuperAdmin(AdminUser $staff): void
    {
        $others = AdminUser::query()
            ->where('role', AdminUser::ROLE_SUPER_ADMIN)
            ->where('is_active', true)
            ->whereKeyNot($staff->getKey())
            ->lockForUpdate()
            ->count();

        if ($others === 0) {
            throw new StaffAccountException('This is the only active super admin. Make someone else a super admin first.');
        }
    }
}
