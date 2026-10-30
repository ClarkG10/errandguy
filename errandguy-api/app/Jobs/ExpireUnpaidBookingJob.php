<?php

namespace App\Jobs;

use App\Enums\PaymentStatus;
use App\Models\Booking;
use App\Models\Payment;
use App\Services\BookingService;
use App\Services\PaymentService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

/**
 * Ends a GCash/Maya errand whose payment never arrived.
 *
 * Queued by booking creation for the end of the payment window
 * (BookingService::paymentDeadline). errandguy:reap-stranded-bookings runs the
 * same handle() from the scheduler, so a lost delayed job (or a crash before it
 * was queued) can't leave an unpaid errand waiting forever.
 */
class ExpireUnpaidBookingJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(
        public string $bookingId,
    ) {}

    /**
     * @return bool true iff this call cancelled the errand.
     */
    public function handle(BookingService $bookings): bool
    {
        $booking = Booking::find($this->bookingId);
        if (! $booking || ! BookingService::awaitingPayment($booking)) {
            return false;
        }

        $deadline = BookingService::paymentDeadline($booking);
        if (now()->lt($deadline)) {
            self::dispatch($this->bookingId)->delay($deadline);

            return false;
        }

        // Ask Xendit before giving up: a customer who paid while the webhook is
        // running late gets their errand (the confirmed payment starts
        // matching), not a wallet refund. A charge Xendit reports declined or
        // expired cancels the errand right here; a gateway hiccup (or a
        // missing gateway config) leaves the charge as it was, and the cancel
        // below goes ahead.
        try {
            $payments = app(PaymentService::class);

            Payment::where('booking_id', $booking->id)
                ->whereIn('status', [PaymentStatus::Pending->value, PaymentStatus::Processing->value])
                ->whereNotNull('gateway_tx_id')
                ->get()
                ->each(fn (Payment $payment) => $payments->reconcileBookingPayment($payment, 0));
        } catch (\Throwable $e) {
            Log::warning('Could not check an unpaid charge with Xendit before cancelling', [
                'booking_id' => $booking->id,
                'error' => $e->getMessage(),
            ]);
        }

        return $bookings->cancelAbandonedPayment($booking->id);
    }
}
