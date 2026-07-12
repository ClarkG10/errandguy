<?php

namespace Tests\Feature\Promo;

use App\Models\PromoCode;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PromoBrowseTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();

        $this->user = User::factory()->create(['role' => 'customer', 'status' => 'active']);
    }

    public function test_lists_only_valid_active_promos(): void
    {
        $valid = PromoCode::factory()->create(['code' => 'VALIDNOW']);
        $expired = PromoCode::factory()->expired()->create(['code' => 'EXPIRED']);
        $inactive = PromoCode::factory()->inactive()->create(['code' => 'INACTIVE']);
        $exhausted = PromoCode::factory()->exhausted()->create(['code' => 'EXHAUSTED']);

        $response = $this->actingAs($this->user)
            ->getJson('/api/v1/promos')
            ->assertOk();

        $codes = collect($response->json('data'))->pluck('code')->all();

        $this->assertContains('VALIDNOW', $codes);
        $this->assertNotContains('EXPIRED', $codes);
        $this->assertNotContains('INACTIVE', $codes);
        $this->assertNotContains('EXHAUSTED', $codes);
    }

    public function test_promo_resource_shape(): void
    {
        PromoCode::factory()->create(['code' => 'SHAPECHECK']);

        $this->actingAs($this->user)
            ->getJson('/api/v1/promos')
            ->assertOk()
            ->assertJsonStructure([
                'data' => [
                    ['id', 'code', 'description', 'discount_type', 'discount_value', 'max_discount', 'min_order', 'valid_until'],
                ],
            ]);
    }

    public function test_future_promo_not_yet_valid_is_excluded(): void
    {
        PromoCode::factory()->create([
            'code' => 'FUTURE',
            'valid_from' => now()->addWeek(),
            'valid_until' => now()->addMonth(),
        ]);

        $response = $this->actingAs($this->user)
            ->getJson('/api/v1/promos')
            ->assertOk();

        $codes = collect($response->json('data'))->pluck('code')->all();
        $this->assertNotContains('FUTURE', $codes);
    }
}
