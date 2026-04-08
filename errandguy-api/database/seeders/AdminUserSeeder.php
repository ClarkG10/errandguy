<?php

namespace Database\Seeders;

use App\Models\AdminUser;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class AdminUserSeeder extends Seeder
{
    public function run(): void
    {
        AdminUser::updateOrCreate(
            ['email' => 'admin@errandguy.ph'],
            [
                'password_hash' => Hash::make('Admin@12345'),
                'full_name' => 'Super Admin',
                'role' => 'super_admin',
                'is_active' => true,
            ]
        );
    }
}
