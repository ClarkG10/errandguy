<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Finished cash errands said "Unpaid" in the staff panel.
 *
 * At completion the runner collects the fare in cash, the payment row moves to
 * completed and the customer is told "paid in cash", but the booking's own
 * payment_status stayed 'unpaid'. BookingSettlementService now marks it 'paid'
 * when the cash is collected; this brings the errands finished before that in
 * line, so the payment filter finds them.
 *
 * Only completed cash errands whose payment row is completed: that row is what
 * settlement writes when the money was collected. Nothing acts on a completed
 * booking's payment_status (cancel, refund, matching and the reapers skip
 * completed errands), so this changes what staff see, not any balance.
 *
 * down() leaves the rows: 'paid' is the true state of these errands.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('bookings')
            ->where('status', 'completed')
            ->where('payment_method', 'cash')
            ->where('payment_status', 'unpaid')
            ->whereExists(fn ($q) => $q->selectRaw('1')
                ->from('payments')
                ->whereColumn('payments.booking_id', 'bookings.id')
                ->where('payments.status', 'completed'))
            ->update(['payment_status' => 'paid']);
    }

    public function down(): void
    {
        //
    }
};
