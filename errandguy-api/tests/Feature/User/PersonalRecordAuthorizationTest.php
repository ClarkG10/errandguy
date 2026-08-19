<?php

namespace Tests\Feature\User;

use App\Models\SavedAddress;
use App\Models\TrustedContact;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * IDOR guard for personal records. Saved addresses and trusted contacts are
 * per-user rows fetched by id; a user must NEVER update or delete another
 * user's row by supplying its id. The controllers enforce this via
 * SavedAddressPolicy / TrustedContactPolicy ($user->id === row->user_id). This
 * locks that invariant so a future refactor that drops the authorize() call —
 * turning a scoped fetch into an open one — is caught immediately.
 */
class PersonalRecordAuthorizationTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_user_cannot_update_or_delete_another_users_saved_address(): void
    {
        $owner = User::factory()->create(['status' => 'active']);
        $attacker = User::factory()->create(['status' => 'active']);

        $address = SavedAddress::create([
            'user_id' => $owner->id, 'label' => 'Home', 'address' => '1 Real St',
            'lat' => 14.6, 'lng' => 120.98, 'is_default' => true,
        ]);

        $this->actingAs($attacker)
            ->putJson("/api/v1/user/addresses/{$address->id}", ['label' => 'Hacked'])
            ->assertStatus(403);
        $this->actingAs($attacker)
            ->deleteJson("/api/v1/user/addresses/{$address->id}")
            ->assertStatus(403);

        // Untouched and still present after the failed attempts.
        $this->assertDatabaseHas('saved_addresses', ['id' => $address->id, 'label' => 'Home']);

        // The owner can.
        $this->actingAs($owner)
            ->putJson("/api/v1/user/addresses/{$address->id}", ['label' => 'Casa'])
            ->assertOk();
        $this->assertDatabaseHas('saved_addresses', ['id' => $address->id, 'label' => 'Casa']);
    }

    public function test_a_user_cannot_update_or_delete_another_users_trusted_contact(): void
    {
        $owner = User::factory()->create(['status' => 'active']);
        $attacker = User::factory()->create(['status' => 'active']);

        $contact = TrustedContact::create([
            'user_id' => $owner->id, 'name' => 'Mom', 'phone' => '+639171234567',
            'relationship' => 'parent', 'priority' => 1, 'is_active' => true,
        ]);

        $this->actingAs($attacker)
            ->putJson("/api/v1/user/trusted-contacts/{$contact->id}", [
                'name' => 'Hacked', 'phone' => '+639170000000', 'relationship' => 'other',
            ])->assertStatus(403);
        $this->actingAs($attacker)
            ->deleteJson("/api/v1/user/trusted-contacts/{$contact->id}")
            ->assertStatus(403);

        $this->assertDatabaseHas('trusted_contacts', ['id' => $contact->id, 'name' => 'Mom']);

        // The owner can.
        $this->actingAs($owner)
            ->putJson("/api/v1/user/trusted-contacts/{$contact->id}", [
                'name' => 'Mama', 'phone' => '+639171234567', 'relationship' => 'parent',
            ])->assertOk();
        $this->assertDatabaseHas('trusted_contacts', ['id' => $contact->id, 'name' => 'Mama']);
    }
}
