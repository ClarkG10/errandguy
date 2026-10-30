<?php

namespace Tests\Feature\Auth;

use App\Models\AdminAlert;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\User;
use App\Support\PhilippinePhone;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Phones are stored and looked up in one shape, +639XXXXXXXXX, however they
 * were typed — so "0917…" and "+63917…" are one number for sign-up, sign-in,
 * the profile, trusted contacts and errand contacts. Existing accounts are
 * converted by a migration that never merges or deletes an account sharing a
 * number with another.
 */
class PhoneNormalizationTest extends TestCase
{
    use RefreshDatabase;

    public function test_the_canonical_shape(): void
    {
        foreach (['09171234567', '+639171234567', '639171234567', '9171234567', '0917 123 4567', '(0917) 123-4567'] as $typed) {
            $this->assertSame('+639171234567', PhilippinePhone::canonical($typed), $typed);
        }
        $this->assertNull(PhilippinePhone::canonical('0217123456'));
        $this->assertNull(PhilippinePhone::canonical(null));
        // The SMS provider still gets 09XXXXXXXXX.
        $this->assertSame('09171234567', PhilippinePhone::normalize('+639171234567'));
    }

    public function test_sign_up_stores_the_canonical_number_and_catches_a_duplicate_in_another_spelling(): void
    {
        $this->postJson('/api/v1/auth/register', [
            'phone' => '0917 123 4567',
            'password' => 'Password1!',
            'full_name' => 'Ana Reyes',
        ])->assertCreated()->assertJsonPath('user.phone', '+639171234567');

        $this->assertDatabaseHas('users', ['phone' => '+639171234567']);

        $this->postJson('/api/v1/auth/register', [
            'phone' => '+639171234567',
            'password' => 'Password1!',
            'full_name' => 'Someone Else',
        ])->assertStatus(422)->assertJsonValidationErrors(['phone']);
    }

    public function test_sign_in_finds_the_account_whichever_way_the_number_is_typed(): void
    {
        User::factory()->create(['phone' => '+639171234567', 'password_hash' => Hash::make('Password1!'), 'status' => 'active']);

        foreach (['09171234567', '639171234567', '+63 917 123 4567'] as $typed) {
            $this->postJson('/api/v1/auth/login', ['phone' => $typed, 'password' => 'Password1!'])
                ->assertOk();
        }
    }

    public function test_an_invalid_number_is_still_rejected(): void
    {
        $this->postJson('/api/v1/auth/register', [
            'phone' => '12345',
            'password' => 'Password1!',
            'full_name' => 'Ana Reyes',
        ])->assertStatus(422)->assertJsonValidationErrors(['phone']);
    }

    public function test_profile_and_trusted_contacts_store_the_canonical_number(): void
    {
        $user = User::factory()->create(['phone' => null, 'status' => 'active', 'role' => 'customer']);

        $this->actingAs($user)->putJson('/api/v1/user/profile', ['phone' => '09181234567'])
            ->assertOk()->assertJsonPath('data.phone', '+639181234567');

        $this->actingAs($user)->postJson('/api/v1/user/trusted-contacts', [
            'name' => 'Mom', 'phone' => '0919-123-4567', 'relationship' => 'parent',
        ])->assertCreated();
        $this->assertDatabaseHas('trusted_contacts', ['user_id' => $user->id, 'phone' => '+639191234567']);
    }

    public function test_a_profile_number_already_used_in_another_spelling_is_refused(): void
    {
        User::factory()->create(['phone' => '+639171234567']);
        $user = User::factory()->create(['phone' => null, 'status' => 'active']);

        $this->actingAs($user)->putJson('/api/v1/user/profile', ['phone' => '09171234567'])
            ->assertStatus(422)->assertJsonValidationErrors(['phone']);
    }

    public function test_errand_contact_numbers_are_stored_canonically(): void
    {
        $this->seed(\Database\Seeders\SystemConfigSeeder::class);
        \Illuminate\Support\Facades\Bus::fake(); // matching is not what this checks
        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'd', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12, 'per_km_motorcycle' => 10,
            'per_km_car' => 18, 'surcharge' => 0, 'is_active' => true, 'sort_order' => 1,
        ]);

        $id = $this->actingAs($customer)->postJson('/api/v1/bookings', [
            'errand_type_id' => $type->id,
            'pickup_address' => 'A', 'pickup_lat' => 14.5995, 'pickup_lng' => 120.9842,
            'pickup_contact_name' => 'Clerk', 'pickup_contact_phone' => '09172220000',
            'dropoff_address' => 'B', 'dropoff_lat' => 14.5547, 'dropoff_lng' => 121.0244,
            'dropoff_contact_name' => 'Lola', 'dropoff_contact_phone' => '639173330000',
            'stops' => [['address' => 'C', 'lat' => 14.54, 'lng' => 121.03, 'contact_name' => 'Tito', 'contact_phone' => '0917 444 0000']],
            'schedule_type' => 'now', 'vehicle_type_rate' => 'motorcycle', 'payment_method' => 'cash',
        ])->assertCreated()->json('data.id');

        $booking = Booking::with('stops')->findOrFail($id);
        $this->assertSame('+639172220000', $booking->pickup_contact_phone);
        $this->assertSame('+639173330000', $booking->dropoff_contact_phone);
        $this->assertSame('+639174440000', $booking->stops->first()->contact_phone);
    }

    public function test_otp_codes_are_keyed_on_the_canonical_number(): void
    {
        $this->postJson('/api/v1/auth/send-otp', ['phone' => '09171234567'])->assertStatus(422); // no SMS provider yet
        $this->assertFalse(\Illuminate\Support\Facades\Cache::has('otp:09171234567'));

        \Illuminate\Support\Facades\Cache::put('otp:+639171234567', Hash::make('123456'), now()->addMinutes(5));
        $this->postJson('/api/v1/auth/verify-otp', ['phone' => '09171234567', 'code' => '123456'])
            ->assertOk()->assertJsonPath('verified', true);
    }

    // ── The data migration ────────────────────────────────────────────

    private function runMigration(): void
    {
        (require database_path('migrations/2026_10_31_000014_normalize_user_phone_numbers.php'))->up();
    }

    private function userWithPhone(string $phone, string $createdAt, string $name = 'Someone'): User
    {
        $user = User::factory()->create(['full_name' => $name]);
        DB::table('users')->where('id', $user->id)->update(['phone' => $phone, 'created_at' => $createdAt]);

        return $user;
    }

    public function test_the_migration_converts_existing_numbers(): void
    {
        $a = $this->userWithPhone('09171234567', '2026-01-01 00:00:00');
        $b = $this->userWithPhone('639181234567', '2026-01-02 00:00:00');
        $c = $this->userWithPhone('+639191234567', '2026-01-03 00:00:00');
        $odd = $this->userWithPhone('n/a', '2026-01-04 00:00:00');

        $this->runMigration();

        $this->assertSame('+639171234567', $a->fresh()->phone);
        $this->assertSame('+639181234567', $b->fresh()->phone);
        $this->assertSame('+639191234567', $c->fresh()->phone);
        $this->assertSame('n/a', $odd->fresh()->phone, 'a value that is not a PH mobile number is left alone');
        $this->assertSame(0, AdminAlert::where('type', 'phone_number_collision')->count());

        // A re-run changes nothing.
        $this->runMigration();
        $this->assertSame('+639171234567', $a->fresh()->phone);
    }

    public function test_a_collision_keeps_the_first_account_converts_it_and_leaves_the_later_one_for_staff(): void
    {
        $first = $this->userWithPhone('09171234567', '2026-01-01 00:00:00', 'First Person');
        $later = $this->userWithPhone('9171234567', '2026-02-01 00:00:00', 'Later Person');

        $this->runMigration();

        $this->assertSame('+639171234567', $first->fresh()->phone);
        $this->assertSame('9171234567', $later->fresh()->phone, 'the later account is never changed');
        $this->assertNotNull($later->fresh(), 'nothing is deleted');

        $alert = AdminAlert::where('type', 'phone_number_collision')->firstOrFail();
        $this->assertStringContainsString($first->id, (string) $alert->body);
        $this->assertStringContainsString($later->id, (string) $alert->body);
    }

    public function test_when_the_later_account_already_holds_the_canonical_number_neither_changes(): void
    {
        $first = $this->userWithPhone('09171234567', '2026-01-01 00:00:00');
        $later = $this->userWithPhone('+639171234567', '2026-02-01 00:00:00');

        $this->runMigration();

        $this->assertSame('09171234567', $first->fresh()->phone);
        $this->assertSame('+639171234567', $later->fresh()->phone);
        $this->assertSame(1, AdminAlert::where('type', 'phone_number_collision')->count());
    }
}
