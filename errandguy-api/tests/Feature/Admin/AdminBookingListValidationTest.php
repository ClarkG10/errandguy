<?php

namespace Tests\Feature\Admin;

use App\Models\AdminUser;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * The admin booking list filters by ?date=, which is fed to Carbon::parse(). An
 * unvalidated malformed value threw InvalidFormatException -> app-level 500
 * (the repo convention is 422, never 5xx). It must be validated like every other
 * date-filtered list endpoint. (audit v4 input)
 */
class AdminBookingListValidationTest extends TestCase
{
    use RefreshDatabase;

    private function actingAsAdmin(): void
    {
        $admin = AdminUser::create([
            'email' => 'ops@errandguy.test', 'password_hash' => Hash::make('Password1!'),
            'full_name' => 'Ops', 'role' => 'admin', 'is_active' => true,
        ]);
        Sanctum::actingAs($admin);
    }

    public function test_malformed_date_filter_is_rejected_422_not_500(): void
    {
        $this->actingAsAdmin();

        // Non-parseable dates must 422 before reaching Carbon::parse (pre-fix: 500).
        $this->getJson('/api/v1/admin/bookings?date=not-a-date')->assertStatus(422);
        $this->getJson('/api/v1/admin/bookings?date=2026-13-99')->assertStatus(422);
    }

    public function test_valid_and_absent_date_filters_still_work(): void
    {
        $this->actingAsAdmin();

        $this->getJson('/api/v1/admin/bookings?date=2026-08-07')->assertOk();
        $this->getJson('/api/v1/admin/bookings')->assertOk();
    }
}
