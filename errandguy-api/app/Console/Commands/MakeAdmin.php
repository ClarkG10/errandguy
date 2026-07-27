<?php

namespace App\Console\Commands;

use App\Models\AdminUser;
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
 *   php artisan errandguy:make-admin
 *   php artisan errandguy:make-admin ops@errandguy.app --name="Ops" --role=ops --password=secret
 *   ADMIN_EMAIL=you@errandguy.app ADMIN_PASSWORD=... php artisan errandguy:make-admin
 */
class MakeAdmin extends Command
{
    protected $signature = 'errandguy:make-admin
        {email? : The admin email}
        {--name= : Full name}
        {--role= : One of super_admin, admin, finance, support, ops}
        {--password= : Password (prompted securely if omitted)}';

    protected $description = 'Create or update an ErrandGuy admin-panel user';

    public function handle(): int
    {
        $interactive = $this->input->isInteractive();

        $email = $this->argument('email') ?: env('ADMIN_EMAIL');
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
        $name = $this->option('name')
            ?: env('ADMIN_NAME')
            ?: ($interactive ? $this->ask('Full name') : Str::of($email)->before('@')->headline());
        $role = $this->option('role')
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

        $existing = AdminUser::where('email', $email)->first();

        $admin = AdminUser::updateOrCreate(
            ['email' => $email],
            [
                'full_name' => $name,
                'role' => $role,
                'password_hash' => Hash::make($password),
                'is_active' => true,
            ],
        );

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
}
