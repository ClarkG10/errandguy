<?php

namespace Database\Seeders;

use App\Models\AdminUser;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class AdminUserSeeder extends Seeder
{
    public function run(): void
    {
        // NO hardcoded fallback password. A seeded super-admin with a password
        // that lives in the repo is an account-takeover risk — doubly so here,
        // where a developer's local .env points at the PRODUCTION database, so a
        // stray `db:seed` would plant known credentials in prod. Credentials must
        // come from env; otherwise skip and defer to the explicit command:
        //   php artisan errandguy:make-admin <email> --role=super_admin --password=…
        $email = env('ADMIN_EMAIL');
        $password = env('ADMIN_PASSWORD');

        if (blank($email) || blank($password)) {
            $this->command?->warn(
                'AdminUserSeeder skipped: set ADMIN_EMAIL and ADMIN_PASSWORD, '
                .'or run `php artisan errandguy:make-admin`.'
            );

            return;
        }

        // Creates the account only. An existing one is left alone: re-seeding
        // used to reset its password and re-enable and promote it, even a
        // staff member deliberately disabled. Changes go through
        // errandguy:make-admin, which is explicit about what it does.
        $admin = AdminUser::firstOrCreate(
            ['email' => $email],
            [
                'password_hash' => Hash::make($password),
                'full_name' => env('ADMIN_NAME', 'Super Admin'),
                'role' => 'super_admin',
                'is_active' => true,
            ]
        );

        $this->command?->info($admin->wasRecentlyCreated
            ? "AdminUserSeeder: created super-admin {$email}."
            : "AdminUserSeeder: {$email} already exists — left unchanged (use errandguy:make-admin to change it).");
    }
}
