<?php

namespace Tests\Feature\Safety;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class TrustedContactValidationTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;

    protected function setUp(): void
    {
        parent::setUp();
        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
    }

    public function test_priority_above_smallint_max_is_rejected_not_a_500(): void
    {
        // `priority` is a signed SMALLINT column (max 32767). Without an upper
        // bound a larger value passed validation and then raised SQLSTATE 22003
        // "Out of range value" under MySQL strict mode — an uncaught 500 on the
        // user's own request. It must now be a clean 422 validation error.
        $response = $this->actingAs($this->customer)
            ->postJson('/api/v1/user/trusted-contacts', [
                'name' => 'Mom',
                'phone' => '09171234567',
                'relationship' => 'parent',
                'priority' => 40000,
            ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['priority']);

        $this->assertDatabaseCount('trusted_contacts', 0);
    }

    public function test_valid_contact_is_created(): void
    {
        $response = $this->actingAs($this->customer)
            ->postJson('/api/v1/user/trusted-contacts', [
                'name' => 'Mom',
                'phone' => '09171234567',
                'relationship' => 'parent',
                'priority' => 1,
            ]);

        $response->assertStatus(201);
        $this->assertDatabaseHas('trusted_contacts', [
            'user_id' => $this->customer->id,
            'name' => 'Mom',
            'priority' => 1,
        ]);
    }

    public function test_a_sixth_contact_is_refused_with_its_own_code(): void
    {
        foreach (range(1, 5) as $n) {
            $this->actingAs($this->customer)
                ->postJson('/api/v1/user/trusted-contacts', [
                    'name' => "Contact {$n}", 'phone' => '0917123456'.$n, 'relationship' => 'friend', 'priority' => $n,
                ])
                ->assertStatus(201);
        }

        $this->actingAs($this->customer)
            ->postJson('/api/v1/user/trusted-contacts', [
                'name' => 'Contact 6', 'phone' => '09171234560', 'relationship' => 'friend', 'priority' => 6,
            ])
            ->assertStatus(422)
            ->assertJsonPath('code', 'TRUSTED_CONTACT_LIMIT')
            ->assertJsonPath('message', 'Maximum of 5 trusted contacts reached.');

        $this->assertDatabaseCount('trusted_contacts', 5);
    }
}
