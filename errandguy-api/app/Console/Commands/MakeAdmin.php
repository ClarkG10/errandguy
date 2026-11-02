<?php

namespace App\Console\Commands;

use App\Models\AdminUser;
use App\Support\StaffSignIn;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

/**
 * Creates (or updates) an admin panel user.
 *
 * Filament's built-in `make:filament-user` can't be used because AdminUser uses
 * custom columns (`full_name`, `password_hash`) rather than name/password. This
 * hashes into `password_hash` and sets an allowed `role`.
 *
 * DEPLOY-SAFE: this runs cleanly as a recurring step in the Forge deploy script.
 * Credentials come from flags, then env (ADMIN_EMAIL / ADMIN_PASSWORD /
 * ADMIN_NAME / ADMIN_ROLE), then interactive prompts. If none are available and
 * there's no TTY (i.e. a non-interactive deploy with no env set), it SKIPS with
 * a notice and exits 0 so the deploy never breaks. updateOrCreate makes it
 * idempotent, so leaving it in the deploy script is harmless.
 *
 * An account that already exists keeps its name and role unless --name /
 * --role say otherwise — the ADMIN_NAME / ADMIN_ROLE env and the prompts only
 * fill them in for a new account — so a deploy re-running this never undoes a
 * rename or a role change made in the panel.
 *
 *   php artisan errandguy:make-admin
 *   php artisan errandguy:make-admin ops@errandguy.app --name="Ops" --role=ops --password=secret
 *   php artisan errandguy:make-admin you@errandguy.app --password=... --reset-two-step   # locked-out super admin
 *   php artisan errandguy:make-admin you@errandguy.app --unlock   # just lift a too-many-attempts lock
 *   ADMIN_EMAIL=you@errandguy.app ADMIN_PASSWORD=... php artisan errandguy:make-admin
 */
class MakeAdmin extends Command
{
    protected $signature = 'errandguy:make-admin
        {email? : The admin email}
        {--name= : Full name (an existing account keeps its own unless given)}
        {--role= : One of super_admin, admin, finance, support, ops (an existing account keeps its own unless given)}
        {--password= : Password (prompted securely if omitted)}
        {--reset-two-step : Also clear their two-step sign-in, to be set up again at next sign-in (lost phone and recovery codes), and lift a sign-in lock}
        {--unlock : Lift the lock after too many failed sign-ins. On its own (no --password) it changes nothing else}';

    protected $description = 'Create or update an ErrandGuy admin-panel user';

    public function handle(): int
    {
        $interactive = $this->input->isInteractive();

        $email = $this->argument('email') ?: env('ADMIN_EMAIL');

        if ($this->option('unlock') && ! $this->option('password') && ! $this->option('reset-two-step')
            && ! $this->option('name') && ! $this->option('role')) {
            return $this->unlockOnly($email ?: ($interactive ? $this->ask('Email') : null));
        }

        $password = $this->option('password') ?: env('ADMIN_PASSWORD');

        // Deploy-safe: nothing to do and nowhere to prompt → skip, don't fail.
        if ((! $email || ! $password) && ! $interactive) {
            $this->components->warn(
                'errandguy:make-admin skipped — provide --email/--password, set ADMIN_EMAIL + ADMIN_PASSWORD, '
                . 'or run interactively to provision an admin.'
            );

            return self::SUCCESS;
        }

        $email = $email ?: $this->ask('Email');
        $existing = AdminUser::where('email', $email)->first();

        $name = $this->option('name')
            ?: $existing?->full_name
            ?: env('ADMIN_NAME')
            ?: ($interactive ? $this->ask('Full name') : Str::of($email)->before('@')->headline());
        $role = $this->option('role')
            ?: $existing?->role
            ?: env('ADMIN_ROLE')
            ?: ($interactive ? $this->choice('Role', AdminUser::ROLES, 0) : AdminUser::ROLE_SUPER_ADMIN);
        $password = $password ?: $this->secret('Password');

        $validator = Validator::make(
            compact('email', 'name', 'role', 'password'),
            [
                'email' => ['required', 'email', 'max:255'],
                'name' => ['required', 'string', 'max:100'],
                'role' => ['required', 'in:' . implode(',', AdminUser::ROLES)],
                'password' => ['required', 'string', 'min:8'],
            ],
        );

        if ($validator->fails()) {
            foreach ($validator->errors()->all() as $error) {
                $this->error($error);
            }

            return self::FAILURE;
        }

        $admin = AdminUser::updateOrCreate(
            ['email' => $email],
            [
                'full_name' => $name,
                'role' => $role,
                'password_hash' => Hash::make($password),
                'is_active' => true,
            ],
        );

        if ($this->option('reset-two-step')) {
            $admin->forceFill([
                'app_authentication_secret' => null,
                'app_authentication_recovery_codes' => null,
                'has_email_authentication' => false,
            ])->save();
            StaffSignIn::unlock($admin->email);
            $this->line('Two-step sign-in cleared; it is set up again at the next sign-in. Any sign-in lock is lifted.');
        } elseif ($this->option('unlock')) {
            StaffSignIn::unlock($admin->email);
            $this->line('Sign-in lock lifted.');
        }

        $this->info(sprintf(
            '%s admin "%s" (%s) with role "%s".',
            $existing ? 'Updated' : 'Created',
            $admin->full_name,
            $admin->email,
            $admin->role,
        ));

        $this->line('Sign in at: ' . url('/admin'));

        return self::SUCCESS;
    }

    /** --unlock on its own: lift an existing account's sign-in lock, change nothing else. */
    private function unlockOnly(?string $email): int
    {
        $admin = $email ? AdminUser::where('email', $email)->first() : null;

        if (! $admin) {
            $this->error($email
                ? "No staff account uses {$email}."
                : 'Give the email of the staff account to unlock.');

            return self::FAILURE;
        }

        StaffSignIn::unlock($admin->email);
        $this->info("Sign-in lock lifted for {$admin->email}.");

        return self::SUCCESS;
    }
}
