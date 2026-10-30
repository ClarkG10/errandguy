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
        $this->errandType = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver', 'icon_name' => 'Package',
            'base_fee' => 50.00, 'per_km_walk' => 15.00, 'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00,
            'per_km_car' => 18.00, 'is_active' => true, 'sort_order' => 1,
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
        $docPath = 'runner-documents/'.$user->id.'/national_id/20260810.jpg';
        Storage::disk('public')->put($docPath, 'gov-id-bytes');
        $doc = RunnerDocument::create([
            'runner_id' => $profile->id, 'document_type' => 'national_id',
            'file_url' => Storage::disk('public')->url($docPath), 'status' => 'approved',
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
        Storage::disk('public')->assertMissing($docPath);
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

    /**
     * What the person wrote elsewhere is erased too — support messages, ticket
     * subjects, review comments, SOS coordinates — while the rows (and the
     * star ratings) stay for the other side and for staff. The other person's
     * words are never touched.
     */
    public function test_account_deletion_erases_what_they_wrote_and_where_they_were(): void
    {
        $user = User::factory()->create(['role' => 'customer', 'status' => 'active', 'wallet_balance' => 0]);
        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        $booking = $this->makeBooking(['customer_id' => $user->id, 'runner_id' => $runner->id]);

        $ticket = \App\Models\SupportTicket::create([
            'user_id' => $user->id, 'booking_id' => $booking->id, 'subject' => 'My address is 12 Secret St',
            'category' => 'booking', 'status' => 'open', 'last_message_at' => now(),
        ]);
        $mine = \App\Models\SupportMessage::create([
            'ticket_id' => $ticket->id, 'sender_id' => $user->id, 'sender_type' => 'user',
            'content' => 'Call me on 09171234567', 'image_url' => 'https://example.test/x.jpg',
        ]);
        $agent = \App\Models\SupportMessage::create([
            'ticket_id' => $ticket->id, 'sender_id' => null, 'sender_type' => 'agent', 'content' => 'We are on it.',
        ]);

        $written = \App\Models\Review::create([
            'booking_id' => $booking->id, 'reviewer_id' => $user->id, 'reviewee_id' => $runner->id,
            'rating' => 4, 'comment' => 'He was late, I live at 12 Secret St',
        ]);
        $received = \App\Models\Review::create([
            'booking_id' => $booking->id, 'reviewer_id' => $runner->id, 'reviewee_id' => $user->id,
            'rating' => 5, 'comment' => 'Lovely customer',
        ]);

        $alert = \App\Models\SOSAlert::create([
            'booking_id' => $booking->id, 'customer_id' => $user->id, 'runner_id' => $runner->id,
            'triggered_by' => $user->id, 'triggered_by_role' => 'customer', 'triggered_at' => now()->subDay(),
            'customer_lat' => 14.55, 'customer_lng' => 121.02, 'runner_lat' => 14.56, 'runner_lng' => 121.03,
            'trigger_lat' => 14.5501, 'trigger_lng' => 121.0201, 'trigger_accuracy_m' => 9, 'trigger_location_source' => 'device',
            'live_link_token' => str_repeat('e', 64), 'live_link_expires_at' => now()->subHours(23), 'status' => 'resolved',
        ]);

        $this->actingAs($user)->deleteJson('/api/v1/user/account')->assertOk();

        $mine->refresh();
        $this->assertSame('[Deleted with the account]', $mine->content);
        $this->assertNull($mine->image_url);
        $this->assertSame('We are on it.', $agent->fresh()->content, 'staff replies stay');
        $this->assertSame('[Deleted with the account]', $ticket->fresh()->subject);

        $this->assertNull($written->fresh()->comment);
        $this->assertSame(4, $written->fresh()->rating, 'the star rating stays');
        $this->assertSame('Lovely customer', $received->fresh()->comment, 'the other person’s words stay');
        $this->assertEqualsWithDelta(4.0, (float) $runner->fresh()->avg_rating, 0.001, 'no average moves');

        $alert->refresh();
        $this->assertNull($alert->trigger_lat);
        $this->assertNull($alert->trigger_lng);
        $this->assertNull($alert->trigger_accuracy_m);
        $this->assertNull($alert->customer_lat);
        $this->assertNull($alert->customer_lng);
        $this->assertNull($alert->live_link_token);
        $this->assertEqualsWithDelta(14.56, (float) $alert->runner_lat, 0.001, 'the runner’s position is not theirs to erase');
        $this->assertSame('resolved', $alert->status, 'the safety record itself stays');
    }

    public function test_account_deletion_removes_private_kyc_documents_from_the_kyc_disk(): void
    {
        // New KYC docs live on the private 'kyc' disk (file_path, no public
        // file_url). Erasure must delete them there too, or a deleted runner's
        // government ID is left behind — a data-retention regression.
        Storage::fake('kyc');
        $user = User::factory()->create(['role' => 'runner', 'status' => 'active', 'wallet_balance' => 0]);
        $profile = RunnerProfile::create([
            'user_id' => $user->id, 'verification_status' => 'approved', 'preferred_types' => [],
        ]);
        $path = 'runner-documents/'.$user->id.'/government_id/secret.jpg';
        Storage::disk('kyc')->put($path, 'gov-id-bytes');
        $doc = RunnerDocument::create([
            'runner_id' => $profile->id, 'document_type' => 'government_id',
            'file_path' => $path, 'file_url' => null, 'status' => 'approved',
        ]);
        Storage::disk('kyc')->assertExists($path);

        $this->actingAs($user)->deleteJson('/api/v1/user/account')->assertOk();

        $this->assertDatabaseMissing('runner_documents', ['id' => $doc->id]);
        Storage::disk('kyc')->assertMissing($path);
    }

    public function test_deletion_with_a_balance_and_nowhere_to_send_it_is_refused(): void
    {
        // Nothing is erased while money would be stranded: a positive balance
        // must be paid out as part of deletion, so the request has to say where.
        $user = User::factory()->create(['role' => 'customer', 'status' => 'active', 'wallet_balance' => 250.00]);
        $addr = SavedAddress::create(['user_id' => $user->id, 'label' => 'Home', 'address' => '1 A St', 'lat' => 14.6, 'lng' => 121.0]);

        $this->actingAs($user)->deleteJson('/api/v1/user/account')
            ->assertStatus(422)
            ->assertJsonPath('code', 'PAYOUT_METHOD_REQUIRED')
            ->assertJsonPath('message', 'Your wallet has ₱250.00. Tell us where to send it — a GCash or Maya number — and we’ll send it to you as part of deleting your account.');

        $this->assertDatabaseHas('saved_addresses', ['id' => $addr->id]);
        $this->assertNull(User::withTrashed()->find($user->id)->deleted_at);
        $this->assertEquals(250.0, (float) $user->fresh()->wallet_balance);
    }

    public function test_deletion_blocked_with_negative_wallet_balance_debt(): void
    {
        // TEST-1: a cash errand leaves the runner owing the platform its service
        // fee (a NEGATIVE balance, netted from future earnings). Deleting would
        // anonymize the account and make that debt uncollectable, so it must be
        // refused — with the one shared cash-debt message.
        $user = User::factory()->create(['role' => 'runner', 'status' => 'active', 'wallet_balance' => -15.00]);

        $this->actingAs($user)->deleteJson('/api/v1/user/account')
            ->assertStatus(422)
            ->assertJsonPath('code', 'CASH_DEBT_OUTSTANDING')
            ->assertJsonPath('message', 'You owe ₱15.00 from cash errands. It’s cleared automatically from your next prepaid earnings; '
                .'cash errands pause at ₱1,000. You can delete your account once it’s cleared.');

        $this->assertNull(User::withTrashed()->find($user->id)->deleted_at);
    }
}
