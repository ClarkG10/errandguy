<?php

namespace Tests\Feature\Admin;

use App\Models\AdminUser;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * The Disputes desk is gone: support tickets are the one complaint channel.
 * No table, no panel page, no dashboard card, no app endpoint — and the
 * migration that drops the table archives every row first.
 */
class DisputeDeskRetiredTest extends TestCase
{
    use RefreshDatabase;

    public function test_the_table_is_gone(): void
    {
        $this->assertFalse(Schema::hasTable('dispute_tickets'));
        $this->assertFileDoesNotExist(app_path('Models/DisputeTicket.php'));
        $this->assertDirectoryDoesNotExist(app_path('Filament/Resources/DisputeTickets'));
    }

    public function test_the_old_report_endpoint_is_gone(): void
    {
        $user = User::factory()->create(['role' => 'customer', 'status' => 'active']);

        $this->actingAs($user)
            ->postJson('/api/v1/support/report', ['subject' => 'x', 'description' => 'y', 'category' => 'other'])
            ->assertNotFound();
    }

    public function test_the_panel_has_no_disputes_page_or_card(): void
    {
        $admin = AdminUser::forceCreate([
            'email' => 'super@errandguy.test', 'password_hash' => Hash::make('Password1!'),
            'full_name' => 'Super Admin', 'role' => 'super_admin', 'is_active' => true,
            'has_email_authentication' => true, // two-step sign-in set up
        ]);
        $this->actingAs($admin, 'admin');

        $this->get('/admin/dispute-tickets')->assertNotFound();
        $this->get('/admin')->assertOk()->assertDontSee('Open disputes');
    }

    public function test_the_migration_archives_every_dispute_before_dropping_the_table(): void
    {
        $migration = require database_path('migrations/2026_10_31_000010_retire_dispute_desk.php');
        $migration->down(); // rebuild the old table to hold a row

        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12, 'per_km_motorcycle' => 10,
            'per_km_car' => 18, 'is_active' => true, 'sort_order' => 1,
        ]);
        $booking = Booking::create([
            'booking_number' => 'EG-DISPUTE-1', 'customer_id' => $customer->id, 'errand_type_id' => $type->id,
            'status' => 'completed', 'pickup_address' => 'A', 'pickup_lat' => 14.6, 'pickup_lng' => 120.98,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02, 'schedule_type' => 'now',
            'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle', 'distance_km' => 5, 'base_fee' => 50,
            'distance_fee' => 50, 'service_fee' => 15, 'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false,
        ]);
        DB::table('dispute_tickets')->insert([
            'id' => '11111111-2222-3333-4444-555555555555',
            'booking_id' => $booking->id, 'reported_by' => $customer->id, 'category' => 'item_damaged',
            'description' => 'The item arrived broken.', 'evidence_urls' => '[]', 'status' => 'open',
            'created_at' => now(), 'updated_at' => now(),
        ]);

        Log::spy();
        $migration->up();
        $migration->up(); // re-run is a no-op

        $this->assertFalse(Schema::hasTable('dispute_tickets'));
        $archived = DB::table('activity_log')->where('log_name', 'retired_disputes')->get();
        $this->assertCount(1, $archived);
        $properties = json_decode((string) $archived->first()->properties, true);
        $this->assertSame('The item arrived broken.', $properties['dispute_ticket']['description']);
        $this->assertSame($booking->id, $properties['dispute_ticket']['booking_id']);
        Log::shouldHaveReceived('warning')
            ->withArgs(fn ($message, $context = []) => $message === 'Retired dispute ticket archived'
                && ($context['dispute_ticket']['id'] ?? null) === '11111111-2222-3333-4444-555555555555')
            ->once();
    }
}
