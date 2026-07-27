<?php

namespace App\Console\Commands;

use App\Models\AdminUser;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;

/**
 * Creates (or updates) an admin panel user.
 *
 * Filament's built-in `make:filament-user` can't be used because AdminUser uses
 * custom columns (`full_name`, `password_hash`) rather than name/password. This
 * hashes into `password_hash` and sets an allowed `role`.
 *
 *   php artisan errandguy:make-admin
 *   php artisan errandguy:make-admin ops@errandguy.app --name="Ops" --role=ops --password=secret
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
        $email = $this->argument('email') ?: $this->ask('Email');
        $name = $this->option('name') ?: $this->ask('Full name');
        $role = $this->option('role') ?: $this->choice('Role', AdminUser::ROLES, 0);
        $password = $this->option('password') ?: $this->secret('Password');

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
