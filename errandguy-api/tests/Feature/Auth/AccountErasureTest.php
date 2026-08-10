<?php

namespace Tests\Feature\Auth;

use App\Models\Booking;
use App\Models\BookingStop;
use App\Models\ErrandType;
use App\Models\RunnerDocument;
use App\Models\RunnerProfile;
use App\Models\SavedAddress;
use App\Models\TrustedContact;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * PRIV-1 regression: deleting an account must honour the right to erasure —
 * KYC documents (rows + files), bank/payout identifiers, saved addresses,
 * trusted contacts and the avatar are removed, and the contact PII the user
 * entered on their own bookings is redacted. Financial records (the bookings
 * themselves) are RETAINED, and another party's PII on a shared booking is
 * never touched.
 */
class AccountErasureTest extends TestCase
{
    use RefreshDatabase;

    private ErrandType $errandType;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
        Storage::fake('local');
        $this->errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver', 'icon_name' => 'Package',
            'base_fee' => 50.00, 'per_km_walk' => 15.00, 'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00,
            'per_km_car' => 18.00, 'min_negotiate_fee' => 30.00, 'is_active' => true, 'sort_order' => 1,
        ]);
    }

    private function makeBooking(array $overrides): Booking
    {
        return Booking::create(array_merge([
            'booking_number' => 'EG-'.substr(uniqid(), -10),
            'errand_type_id' => $this->errandType->id, 'status' => 'completed',
            'pickup_address' => '123 Main', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'pickup_contact_name' => 'Alice', 'pickup_contact_phone' => '+639170000001',
            'dropoff_address' => '456 Oak', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'dropoff_contact_name' => 'Bob', 'dropoff_contact_phone' => '+639170000002',
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 100, 'is_transportation' => false,
        ], $overrides));
    }

    public function test_account_deletion_erases_all_pii_but_retains_financial_records(): void
    {
        $user = User::factory()->create(['role' => 'runner', 'status' => 'active', 'wallet_balance' => 0,
            'avatar_url' => null]);

        // Avatar file
        Storage::disk('public')->put('avatars/'.$user->id.'_x.jpg', 'img');
        $user->update(['avatar_url' => Storage::disk('public')->url('avatars/'.$user->id.'_x.jpg')]);

        // Runner profile + bank/payout identifiers + a KYC document (file on disk)
        $profile = RunnerProfile::create([
            'user_id' => $user->id, 'verification_status' => 'approved', 'preferred_types' => [],
            'bank_name' => 'BPI', 'bank_account_number' => '1234567890', 'ewallet_number' => '09171234567',
            'payout_channel_code' => 'PH_GCASH',
        ]);
        $docPath = 'runner-documents/'.$user->id.'/national_id/20260810_x.jpg';
        Storage::disk('local')->put($docPath, 'gov-id-bytes'); // KYC lives on the PRIVATE disk now
        $doc = RunnerDocument::create([
            'runner_id' => $profile->id, 'document_type' => 'national_id',
            'file_path' => $docPath, 'status' => 'approved',
        ]);

        // Saved address + trusted contact
        $addr = SavedAddress::create(['user_id' => $user->id, 'label' => 'Home', 'address' => '1 A St', 'lat' => 14.6, 'lng' => 121.0]);
        $contact = TrustedContact::create(['user_id' => $user->id, 'name' => 'Mom', 'phone' => '+639170000009', 'relationship' => 'parent']);

        // The user's OWN (customer) booking — contacts must be redacted, row kept.
        $ownBooking = $this->makeBooking(['customer_id' => $user->id]);
        $ownStop = BookingStop::create(['booking_id' => $ownBooking->id, 'sequence' => 1, 'address' => 'Z', 'lat' => 14.6, 'lng' => 121.0,
            'contact_name' => 'Carol', 'contact_phone' => '+639170000003']);

        // A booking where the user is only the RUNNER — the customer's contact
        // PII on it must NOT be touched.
        $other = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $otherBooking = $this->makeBooking(['customer_id' => $other->id, 'runner_id' => $user->id]);

        $this->actingAs($user)->deleteJson('/api/v1/user/account')->assertOk();

        // KYC doc row + file gone.
        $this->assertDatabaseMissing('runner_documents', ['id' => $doc->id]);
        Storage::disk('local')->assertMissing($docPath);
        // Bank/payout identifiers scrubbed.
        $profile->refresh();
        $this->assertNull($profile->bank_name);
        $this->assertNull($profile->bank_account_number);
        $this->assertNull($profile->ewallet_number);
        $this->assertNull($profile->payout_channel_code);
        // Address + contact rows gone.
        $this->assertDatabaseMissing('saved_addresses', ['id' => $addr->id]);
        $this->assertDatabaseMissing('trusted_contacts', ['id' => $contact->id]);
        // Avatar file gone.
        Storage::disk('public')->assertMissing('avatars/'.$user->id.'_x.jpg');

        // Own booking retained but contacts redacted (incl. its stop).
        $this->assertDatabaseHas('bookings', ['id' => $ownBooking->id]);
        $ownBooking->refresh();
        $this->assertNull($ownBooking->pickup_contact_name);
        $this->assertNull($ownBooking->pickup_contact_phone);
        $this->assertNull($ownBooking->dropoff_contact_name);
        $this->assertNull($ownBooking->dropoff_contact_phone);
        $this->assertNull($ownStop->fresh()->contact_name);

        // The OTHER party's booking contacts are untouched.
        $otherBooking->refresh();
        $this->assertSame('Alice', $otherBooking->pickup_contact_name);

        // Account soft-deleted and anonymized; tokens revoked.
        $deleted = User::withTrashed()->find($user->id);
        $this->assertNotNull($deleted->deleted_at);
        $this->assertSame('Deleted User', $deleted->full_name);
        $this->assertNull($deleted->email);
        $this->assertNull($deleted->avatar_url);
        $this->assertSame(0, $deleted->tokens()->count());
    }

    public function test_deletion_blocked_with_unpaid_wallet_balance(): void
    {
        // Guard still holds — nothing is erased if the runner has funds.
        $user = User::factory()->create(['role' => 'runner', 'status' => 'active', 'wallet_balance' => 250.00]);
        $addr = SavedAddress::create(['user_id' => $user->id, 'label' => 'Home', 'address' => '1 A St', 'lat' => 14.6, 'lng' => 121.0]);

        $this->actingAs($user)->deleteJson('/api/v1/user/account')->assertStatus(422);

        $this->assertDatabaseHas('saved_addresses', ['id' => $addr->id]);
        $this->assertNull(User::withTrashed()->find($user->id)->deleted_at);
    }

    public function test_deletion_blocked_with_negative_wallet_balance_debt(): void
    {
        // TEST-1: a cash errand leaves the runner owing the platform its service
        // fee (a NEGATIVE balance, netted from future earnings). Deleting would
        // anonymize the account and make that debt uncollectable, so it must be
        // refused — the pre-existing guard only blocked positive balances.
        $user = User::factory()->create(['role' => 'runner', 'status' => 'active', 'wallet_balance' => -15.00]);

        $this->actingAs($user)->deleteJson('/api/v1/user/account')->assertStatus(422);

        $this->assertNull(User::withTrashed()->find($user->id)->deleted_at);
    }
}
