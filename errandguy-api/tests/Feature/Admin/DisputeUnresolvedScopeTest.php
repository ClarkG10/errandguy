<?php

namespace Tests\Feature\Admin;

use App\Models\Booking;
use App\Models\DisputeTicket;
use App\Models\ErrandType;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * "Needs attention" dispute counts must include EVERY non-resolved status —
 * especially escalated, the urgent one. The ops ActionQueue widget and the
 * DisputeTicket nav badge previously counted only [open, reviewing], so an
 * escalated dispute was invisible in the ops queue; the API dashboard counted
 * [open, escalated], dropping reviewing. All now share DisputeTicket::unresolved().
 */
class DisputeUnresolvedScopeTest extends TestCase
{
    use RefreshDatabase;

    public function test_unresolved_scope_counts_every_non_resolved_status_including_escalated(): void
    {
        $this->seed(\Database\Seeders\SystemConfigSeeder::class);

        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'd', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12, 'per_km_motorcycle' => 10,
            'per_km_car' => 18, 'min_negotiate_fee' => 30, 'is_active' => true, 'sort_order' => 1,
        ]);
        $booking = Booking::create([
            'booking_number' => 'EG-20260331-DUS1', 'customer_id' => $customer->id,
            'errand_type_id' => $type->id, 'status' => 'completed', 'pickup_address' => 'a',
            'pickup_lat' => 14.6, 'pickup_lng' => 120.98, 'dropoff_address' => 'b', 'dropoff_lat' => 14.55,
            'dropoff_lng' => 121.02, 'schedule_type' => 'now', 'pricing_mode' => 'fixed',
            'vehicle_type_rate' => 'motorcycle', 'distance_km' => 5, 'base_fee' => 50, 'distance_fee' => 50,
            'service_fee' => 15, 'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false,
        ]);

        foreach (['open', 'reviewing', 'escalated', 'resolved'] as $status) {
            DisputeTicket::create([
                'booking_id' => $booking->id, 'reported_by' => $customer->id,
                'category' => 'payment', 'description' => 'x', 'status' => $status,
            ]);
        }

        // open + reviewing + escalated = 3; resolved excluded.
        $this->assertSame(3, DisputeTicket::unresolved()->count());
        // The escalated (urgent) dispute must be in the set — the exact one the
        // ops ActionQueue + nav badge used to drop.
        $this->assertSame(1, DisputeTicket::unresolved()->where('status', 'escalated')->count());
    }
}
