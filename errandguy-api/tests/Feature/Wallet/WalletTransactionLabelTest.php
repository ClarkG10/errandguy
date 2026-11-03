<?php

namespace Tests\Feature\Wallet;

use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\User;
use App\Models\WalletTransaction;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * WalletTransaction::$display_description is $appended, so it serializes on every
 * transaction that goes out. It must NOT lazy-query the booking per row (a latent
 * N+1) — it enriches only when booking.errandType is eager-loaded, and otherwise
 * falls back to a generic label. (audit M2)
 */
class WalletTransactionLabelTest extends TestCase
{
    use RefreshDatabase;

    private function paymentTx(): array
    {
        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'd', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12, 'per_km_motorcycle' => 10,
            'per_km_car' => 18, 'is_active' => true, 'sort_order' => 1,
        ]);
        $booking = Booking::create([
            'booking_number' => 'EG-20260817-LBL111', 'customer_id' => $customer->id,
            'errand_type_id' => $type->id, 'status' => 'completed', 'pickup_address' => 'a',
            'pickup_lat' => 14.6, 'pickup_lng' => 120.98, 'dropoff_address' => 'b', 'dropoff_lat' => 14.55,
            'dropoff_lng' => 121.02, 'schedule_type' => 'now', 'pricing_mode' => 'fixed',
            'vehicle_type_rate' => 'motorcycle', 'distance_km' => 5, 'base_fee' => 50, 'distance_fee' => 50,
            'service_fee' => 15, 'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false,
        ]);
        $tx = WalletTransaction::create([
            'user_id' => $customer->id, 'type' => 'payment', 'amount' => -115,
            'balance_after' => 0, 'reference_id' => $booking->id, 'description' => 'Payment',
        ]);

        return [$tx, $booking];
    }

    public function test_enriched_label_when_booking_is_eager_loaded(): void
    {
        [$tx, $booking] = $this->paymentTx();

        $loaded = WalletTransaction::with('booking.errandType')->find($tx->id);

        $this->assertStringContainsString('Paid for Delivery', $loaded->display_description);
        $this->assertStringContainsString($booking->booking_number, $loaded->display_description);
    }

    public function test_label_leads_with_the_errand_not_the_brand(): void
    {
        [$tx, $booking] = $this->paymentTx();

        $loaded = WalletTransaction::with('booking.errandType')->find($tx->id);

        // One-line ledger rows: a "ErrandGuy · " prefix pushed the errand
        // number off the end.
        $this->assertSame("Paid for Delivery #{$booking->booking_number}", $loaded->display_description);
    }

    public function test_a_customer_withdrawal_reads_as_a_withdrawal_and_a_runner_payout_as_a_payout(): void
    {
        $user = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $destination = ['channel' => 'gcash', 'account_number' => '+639171234567', 'account_name' => 'Rina Cruz'];

        $withdrawal = WalletTransaction::create([
            'user_id' => $user->id, 'type' => 'payout', 'amount' => -100, 'balance_after' => 0,
            'description' => 'Withdrawal request', 'status' => 'pending', 'payout_destination' => $destination,
        ]);
        $onDeletion = WalletTransaction::create([
            'user_id' => $user->id, 'type' => 'payout', 'amount' => -50, 'balance_after' => 0,
            'description' => 'Withdrawal on account deletion', 'status' => 'pending', 'payout_destination' => $destination,
        ]);
        $runnerPayout = WalletTransaction::create([
            'user_id' => $user->id, 'type' => 'payout', 'amount' => -300, 'balance_after' => 0,
            'description' => 'Payout request', 'status' => 'pending', 'payout_destination' => $destination,
        ]);

        // The app's button says "Withdraw"; the row now agrees.
        $this->assertSame('Withdrawal to GCash •••• 4567', $withdrawal->fresh()->display_description);
        $this->assertSame('Withdrawal to GCash •••• 4567', $onDeletion->fresh()->display_description);
        // The runner's earnings still go out as a "payout", as their screens say.
        $this->assertSame('Payout to GCash •••• 4567', $runnerPayout->fresh()->display_description);
    }

    public function test_no_lazy_query_when_booking_is_not_loaded(): void
    {
        [$tx] = $this->paymentTx();

        $fresh = WalletTransaction::find($tx->id);
        $this->assertFalse($fresh->relationLoaded('booking'));

        $queries = 0;
        DB::listen(function () use (&$queries): void {
            $queries++;
        });

        $label = $fresh->display_description;

        // The accessor must not hit the DB, and must fall back to the generic
        // label rather than the booking-enriched one.
        $this->assertSame(0, $queries, 'display_description must not lazy-query the booking');
        $this->assertStringNotContainsString('Paid for Delivery', $label);
    }
}
