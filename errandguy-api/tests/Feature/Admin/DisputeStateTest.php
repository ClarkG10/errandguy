<?php

namespace Tests\Feature\Admin;

use App\Models\AdminUser;
use App\Models\Booking;
use App\Models\DisputeTicket;
use App\Models\ErrandType;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Dispute resolve/escalate must guard the CURRENT status (like every other
 * money/state path), or a trusted-but-fat-fingered support admin can: re-resolve
 * a closed ticket — re-firing the reporter push and OVERWRITING the original
 * resolver + resolution text (audit-trail corruption) — or illegally reopen a
 * resolved dispute back to 'escalated'. This locks the transition rules.
 */
class DisputeStateTest extends TestCase
{
    use RefreshDatabase;

    private function admin(string $role = 'support'): AdminUser
    {
        return AdminUser::create([
            'email' => $role.'@errandguy.test', 'password_hash' => Hash::make('Password1!'),
            'full_name' => ucfirst($role), 'role' => $role, 'is_active' => true,
        ]);
    }

    private function dispute(string $status = 'open', array $extra = []): DisputeTicket
    {
        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'd', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12, 'per_km_motorcycle' => 10,
            'per_km_car' => 18, 'min_negotiate_fee' => 30, 'is_active' => true, 'sort_order' => 1,
        ]);
        $booking = Booking::create([
            'booking_number' => 'EG-20260331-DSP'.substr(md5($status.json_encode($extra)), 0, 3),
            'customer_id' => $customer->id, 'errand_type_id' => $errandType->id, 'status' => 'completed',
            'pickup_address' => 'a', 'pickup_lat' => 14.6, 'pickup_lng' => 120.98, 'dropoff_address' => 'b',
            'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02, 'schedule_type' => 'now', 'pricing_mode' => 'fixed',
            'vehicle_type_rate' => 'motorcycle', 'distance_km' => 5, 'base_fee' => 50, 'distance_fee' => 50,
            'service_fee' => 15, 'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false,
        ]);

        return DisputeTicket::create(array_merge([
            'booking_id' => $booking->id, 'reported_by' => $customer->id,
            'category' => 'payment', 'description' => 'Overcharged', 'status' => $status,
        ], $extra));
    }

    public function test_resolving_an_already_resolved_dispute_is_idempotent_and_preserves_the_original_resolver(): void
    {
        $original = $this->admin('support');
        $dispute = $this->dispute('resolved', [
            'resolution' => 'ORIGINAL resolution', 'resolved_by' => $original->id, 'resolved_at' => now(),
        ]);

        // A DIFFERENT admin re-resolves with different text.
        $later = $this->admin('ops');
        Queue::fake(); // fake AFTER fixtures so only the action's jobs are asserted
        Sanctum::actingAs($later);

        $this->postJson("/api/v1/admin/disputes/{$dispute->id}/resolve", [
            'resolution_note' => 'DIFFERENT text',
        ])->assertOk()->assertJsonPath('message', 'Dispute already resolved.');

        // Original resolver + resolution preserved; not overwritten.
        $this->assertDatabaseHas('dispute_tickets', [
            'id' => $dispute->id, 'status' => 'resolved',
            'resolution' => 'ORIGINAL resolution', 'resolved_by' => $original->id,
        ]);

        // No duplicate reporter push on the no-op.
        Queue::assertNothingPushed();
    }

    public function test_a_resolved_dispute_cannot_be_escalated(): void
    {
        $dispute = $this->dispute('resolved', [
            'resolution' => 'done', 'resolved_by' => $this->admin('support')->id, 'resolved_at' => now(),
        ]);

        Sanctum::actingAs($this->admin('ops'));

        $this->postJson("/api/v1/admin/disputes/{$dispute->id}/escalate")
            ->assertJsonPath('code', 'CONFLICT');

        // Still resolved — the illegal reopen was refused.
        $this->assertDatabaseHas('dispute_tickets', ['id' => $dispute->id, 'status' => 'resolved']);
    }

    public function test_resolving_an_open_dispute_transitions_and_notifies_once(): void
    {
        $dispute = $this->dispute('open');
        $admin = $this->admin('support');
        Queue::fake(); // fake AFTER fixtures so only the action's jobs are asserted
        Sanctum::actingAs($admin);

        $this->postJson("/api/v1/admin/disputes/{$dispute->id}/resolve", [
            'resolution_note' => 'Refunded and closed',
        ])->assertOk()->assertJsonPath('message', 'Dispute resolved.');

        $this->assertDatabaseHas('dispute_tickets', [
            'id' => $dispute->id, 'status' => 'resolved',
            'resolution' => 'Refunded and closed', 'resolved_by' => $admin->id,
        ]);
        Queue::assertPushed(\App\Jobs\SendPushJob::class, 1);
    }

    public function test_escalate_is_idempotent_on_an_already_escalated_dispute(): void
    {
        $dispute = $this->dispute('escalated');
        Sanctum::actingAs($this->admin('support'));

        $this->postJson("/api/v1/admin/disputes/{$dispute->id}/escalate")
            ->assertOk()->assertJsonPath('message', 'Dispute escalated.');

        $this->assertDatabaseHas('dispute_tickets', ['id' => $dispute->id, 'status' => 'escalated']);
    }
}
