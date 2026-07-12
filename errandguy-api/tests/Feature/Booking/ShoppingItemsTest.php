<?php

namespace Tests\Feature\Booking;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\RunnerProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ShoppingItemsTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private User $runner;
    private ErrandType $errandType;
    private Booking $booking;

    protected function setUp(): void
    {
        parent::setUp();

        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);

        RunnerProfile::create([
            'user_id' => $this->runner->id,
            'verification_status' => 'approved',
            'is_online' => true,
            'preferred_types' => [],
        ]);

        $this->errandType = ErrandType::create([
            'slug' => 'grocery', 'name' => 'Grocery', 'description' => 'Buy groceries',
            'icon_name' => 'ShoppingCart', 'base_fee' => 50.00, 'per_km_walk' => 15.00,
            'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00, 'per_km_car' => 18.00,
            'min_negotiate_fee' => 30.00, 'is_active' => true, 'sort_order' => 1,
        ]);

        $this->booking = Booking::create([
            'booking_number' => 'EG-20260710-SHOP',
            'customer_id' => $this->customer->id, 'runner_id' => $this->runner->id,
            'errand_type_id' => $this->errandType->id, 'status' => 'accepted',
            'pickup_address' => '123 Main', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '456 Oak', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'shopping_budget' => 1000, 'is_transportation' => false,
        ]);
    }

    public function test_customer_can_set_shopping_list(): void
    {
        $response = $this->actingAs($this->customer)
            ->putJson("/api/v1/bookings/{$this->booking->id}/shopping-items", [
                'items' => [
                    ['name' => 'Milk', 'qty' => 2],
                    ['name' => 'Eggs'],
                ],
            ]);

        $response->assertOk()
            ->assertJsonCount(2, 'data.shopping_items')
            ->assertJsonPath('data.shopping_items.0.name', 'Milk')
            ->assertJsonPath('data.shopping_items.0.qty', 2)
            ->assertJsonPath('data.shopping_items.0.checked', false)
            ->assertJsonPath('data.shopping_items.1.qty', 1);

        $this->booking->refresh();
        $this->assertCount(2, $this->booking->shopping_items);
        $this->assertNotEmpty($this->booking->shopping_items[0]['id']);
    }

    public function test_customer_set_requires_item_name(): void
    {
        $response = $this->actingAs($this->customer)
            ->putJson("/api/v1/bookings/{$this->booking->id}/shopping-items", [
                'items' => [
                    ['qty' => 2],
                ],
            ]);

        $response->assertStatus(422);
    }

    public function test_non_owner_cannot_set_shopping_list(): void
    {
        $other = User::factory()->create(['role' => 'customer', 'status' => 'active']);

        $response = $this->actingAs($other)
            ->putJson("/api/v1/bookings/{$this->booking->id}/shopping-items", [
                'items' => [['name' => 'Milk']],
            ]);

        $response->assertStatus(404);
    }

    public function test_cannot_edit_list_after_pickup(): void
    {
        $this->booking->update(['status' => 'picked_up']);

        $response = $this->actingAs($this->customer)
            ->putJson("/api/v1/bookings/{$this->booking->id}/shopping-items", [
                'items' => [['name' => 'Milk']],
            ]);

        $response->assertStatus(422);
    }

    public function test_assigned_runner_can_toggle_a_tick(): void
    {
        $this->seedList();
        $itemId = $this->booking->fresh()->shopping_items[0]['id'];

        $response = $this->actingAs($this->runner)
            ->patchJson("/api/v1/runner/errand/{$this->booking->id}/shopping-items", [
                'items' => [
                    ['id' => $itemId, 'checked' => true],
                ],
            ]);

        $response->assertOk()
            ->assertJsonPath('data.shopping_items.0.checked', true);

        $this->booking->refresh();
        $this->assertTrue($this->booking->shopping_items[0]['checked']);
        $this->assertNotNull($this->booking->shopping_items[0]['checked_at']);
        // The second item is untouched.
        $this->assertFalse($this->booking->shopping_items[1]['checked']);
    }

    public function test_runner_can_untick_an_item(): void
    {
        $this->seedList();
        $itemId = $this->booking->fresh()->shopping_items[0]['id'];

        $this->actingAs($this->runner)
            ->patchJson("/api/v1/runner/errand/{$this->booking->id}/shopping-items", [
                'items' => [['id' => $itemId, 'checked' => true]],
            ])->assertOk();

        $this->actingAs($this->runner)
            ->patchJson("/api/v1/runner/errand/{$this->booking->id}/shopping-items", [
                'items' => [['id' => $itemId, 'checked' => false]],
            ])->assertOk()
            ->assertJsonPath('data.shopping_items.0.checked', false)
            ->assertJsonPath('data.shopping_items.0.checked_at', null);
    }

    public function test_non_assigned_runner_cannot_toggle(): void
    {
        $this->seedList();
        $itemId = $this->booking->fresh()->shopping_items[0]['id'];

        $otherRunner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        RunnerProfile::create([
            'user_id' => $otherRunner->id,
            'verification_status' => 'approved',
            'is_online' => true,
            'preferred_types' => [],
        ]);

        $response = $this->actingAs($otherRunner)
            ->patchJson("/api/v1/runner/errand/{$this->booking->id}/shopping-items", [
                'items' => [['id' => $itemId, 'checked' => true]],
            ]);

        $response->assertStatus(403);
    }

    public function test_customer_sees_runner_ticks(): void
    {
        $this->seedList();
        $itemId = $this->booking->fresh()->shopping_items[0]['id'];

        $this->actingAs($this->runner)
            ->patchJson("/api/v1/runner/errand/{$this->booking->id}/shopping-items", [
                'items' => [['id' => $itemId, 'checked' => true]],
            ])->assertOk();

        // Customer reads the booking back and sees the tick reflected.
        $response = $this->actingAs($this->customer)
            ->getJson("/api/v1/bookings/{$this->booking->id}");

        $response->assertOk()
            ->assertJsonPath('data.shopping_items.0.checked', true);
    }

    public function test_runner_cannot_toggle_on_closed_errand(): void
    {
        $this->seedList();
        $itemId = $this->booking->fresh()->shopping_items[0]['id'];
        $this->booking->update(['status' => 'completed']);

        $response = $this->actingAs($this->runner)
            ->patchJson("/api/v1/runner/errand/{$this->booking->id}/shopping-items", [
                'items' => [['id' => $itemId, 'checked' => true]],
            ]);

        $response->assertStatus(422);
    }

    private function seedList(): void
    {
        $this->booking->update([
            'shopping_items' => [
                ['id' => 'item-1', 'name' => 'Milk', 'qty' => 2, 'checked' => false, 'checked_at' => null],
                ['id' => 'item-2', 'name' => 'Eggs', 'qty' => 1, 'checked' => false, 'checked_at' => null],
            ],
        ]);
    }
}
