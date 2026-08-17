<?php

namespace App\Services;

use App\Enums\PaymentStatus;
use App\Events\BookingCancelled;
use App\Models\Booking;
use App\Models\BookingStatusLog;
use App\Models\ErrandType;
use App\Models\Payment;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class BookingService
{
    public function __construct(
        private PricingService $pricingService,
        private PromoService $promoService,
    ) {}

    /**
     * Generate a booking number in format EG-YYYYMMDD-XXXXXX.
     *
     * The exists()-check loop is not a hard guarantee — there is still a
     * check-then-insert window where two same-millisecond creates could pick the
     * same suffix and the second insert would hit the unique index. Widening the
     * suffix from 4 to 6 chars takes the same-day collision space from ~1.7M to
     * ~2.2B, so that residual race is now ~1300x rarer (effectively never for
     * this app's volume). The value is an opaque display string (the clients do
     * not parse its structure), so the extra length is safe.
     */
    public function generateBookingNumber(): string
    {
        do {
            $number = 'EG-' . now()->format('Ymd') . '-' . strtoupper(Str::random(6));
        } while (Booking::where('booking_number', $number)->exists());

        return $number;
    }

    /**
     * Generate a 4-digit ride PIN for transportation bookings.
     */
    public function generateRidePin(): string
    {
        return str_pad((string) random_int(0, 9999), 4, '0', STR_PAD_LEFT);
    }

    /**
     * Log a booking status change.
     */
    public function logStatusChange(
        string $bookingId,
        string $status,
        ?string $changedBy = null,
        ?string $note = null,
        ?float $lat = null,
        ?float $lng = null
    ): BookingStatusLog {
        return BookingStatusLog::create([
            'booking_id' => $bookingId,
            'status' => $status,
            'changed_by' => $changedBy,
            'note' => $note,
            'lat' => $lat,
            'lng' => $lng,
        ]);
    }

    /**
     * Check if a booking can be cancelled based on current status.
     */
    public function isCancellable(Booking $booking): bool
    {
        return in_array($booking->status, ['pending', 'matched', 'accepted']);
    }

    /**
     * Duplicate a booking for rebooking.
     */
    public function rebook(Booking $original): Booking
    {
        $errandType = ErrandType::findOrFail($original->errand_type_id);
        $isTransportation = $errandType->slug === 'transportation';

        return Booking::create([
            'booking_number' => $this->generateBookingNumber(),
            'customer_id' => $original->customer_id,
            'errand_type_id' => $original->errand_type_id,
            'status' => 'pending',
            'pickup_address' => $original->pickup_address,
            'pickup_lat' => $original->pickup_lat,
            'pickup_lng' => $original->pickup_lng,
            'pickup_contact_name' => $original->pickup_contact_name,
            'pickup_contact_phone' => $original->pickup_contact_phone,
            'dropoff_address' => $original->dropoff_address,
            'dropoff_lat' => $original->dropoff_lat,
            'dropoff_lng' => $original->dropoff_lng,
            'dropoff_contact_name' => $original->dropoff_contact_name,
            'dropoff_contact_phone' => $original->dropoff_contact_phone,
            'description' => $original->description,
            'special_instructions' => $original->special_instructions,
            'estimated_item_value' => $original->estimated_item_value,
            'schedule_type' => 'now',
            'pricing_mode' => $original->pricing_mode,
            'vehicle_type_rate' => $original->vehicle_type_rate,
            'distance_km' => $original->distance_km,
            'base_fee' => $original->base_fee,
            'distance_fee' => $original->distance_fee,
            'service_fee' => $original->service_fee,
            'surcharge' => $original->surcharge,
            'total_amount' => $original->total_amount,
            'runner_payout' => $original->runner_payout,
            'is_transportation' => $isTransportation,
            'ride_pin' => $isTransportation ? $this->generateRidePin() : null,
        ]);
    }

    /**
     * Full-refund-no-fee primitive: return the entire collected amount when a
     * booking ends through no fault of the customer — no runner was ever
     * matched (MatchRunnerJob → no_runner / AutoCancelBookingJob / negotiate
     * expiry) OR an admin/platform cancelled it. Unlike a customer-initiated
     * cancellation, NO cancellation fee is withheld.
     *
     * Idempotent + race-safe: locks the booking and only acts while
     * payment_status is 'paid', so a repeat call (both no-runner paths can fire
     * for the same booking) is a no-op. Relies on the idempotent
     * WalletService::refund + the Payment state machine. Refunds to the wallet,
     * matching the cancellation refund path (gateway reversal is not wired).
     * Cash / unpaid / already-refunded bookings collected nothing to return.
     */
    /**
     * Admin/platform-initiated cancel — the single money-safe path shared by
     * BookingManagementController::cancel and the Filament BookingResource
     * cancel action.
     *
     * Because an admin/platform cancel is not the customer's fault, a paid
     * booking is refunded IN FULL with no cancellation fee (unlike the
     * customer-initiated cancel), via the shared refundUnfulfilled primitive.
     *
     * @throws BookingStateException when the booking is already finalized.
     */
    public function adminCancel(string $bookingId, string $adminId, string $reason): void
    {
        $booking = Booking::findOrFail($bookingId);

        if (in_array($booking->status, ['completed', 'cancelled'], true)) {
            throw new \App\Exceptions\BookingStateException('Booking already finalized');
        }

        $booking->update([
            'status' => 'cancelled',
            'cancelled_at' => now(),
            // cancelled_by is a uuid column — record the acting admin's real id.
            'cancelled_by' => $adminId,
            'cancellation_reason' => $reason,
        ]);

        // Don't leave the assigned runner's GPS pings tagged to the cancelled
        // booking for the next ~30s (per-runner active-booking cache).
        if ($booking->runner_id) {
            Cache::forget("runner_active_booking_id:{$booking->runner_id}");
        }

        // Notify + broadcast the cancellation. BookingCancelled keeps its push
        // listener (the customer should learn an admin cancelled their booking)
        // and now also broadcasts `booking.status` to the booking channel, so
        // both apps drop out of the active trip live — the admin-cancel path
        // previously dispatched no event at all.
        event(new BookingCancelled($booking));

        $this->refundUnfulfilled($booking->id, 'Admin cancelled the booking');
    }

    /**
     * Admin re-runs matching for a STUCK errand (no runner assigned yet). Only
     * valid while the booking is `no_runner` or still `pending` — a booking
     * already matched/accepted/in-progress must never be pulled back to pending
     * (that would strand the assigned runner mid-errand).
     *
     * MatchRunnerJob / BroadcastToRunnersJob only act on a `pending` booking, so
     * reset the status to pending first, then re-dispatch in the booking's own
     * pricing mode. An optional wider radius helps when the default search found
     * nobody nearby.
     */
    public function adminRematch(string $bookingId, ?float $radiusKm = null): void
    {
        $booking = Booking::findOrFail($bookingId);

        if (! in_array($booking->status, ['no_runner', 'pending'], true)) {
            throw new \App\Exceptions\BookingStateException(
                'Only an unmatched errand (no runner assigned yet) can be re-matched.'
            );
        }

        // Back to pending so the matching jobs — which no-op on any other
        // status — will pick it up again.
        $booking->update(['status' => 'pending']);

        BookingStatusLog::create([
            'booking_id' => $booking->id,
            'status' => 'pending',
            // changed_by is a FK to users; an admin_users id would violate it, so
            // record this as a system change (null). The acting admin is captured
            // in the Filament audit log (AdminNotify 'booking.rematch').
            'changed_by' => null,
            'note' => $radiusKm
                ? "Admin re-ran matching (radius {$radiusKm} km)"
                : 'Admin re-ran matching',
        ]);

        // Re-dispatch in the booking's own pricing mode: fixed price auto-matches
        // the nearest runner; negotiate broadcasts the offer to nearby runners.
        if ($booking->pricing_mode === 'fixed') {
            \App\Jobs\MatchRunnerJob::dispatch($booking->id, $radiusKm);
        } else {
            \App\Jobs\BroadcastToRunnersJob::dispatch($booking->id);
        }
    }

    public function refundUnfulfilled(string $bookingId, string $reason): void
    {
        DB::transaction(function () use ($bookingId, $reason) {
            $locked = Booking::whereKey($bookingId)->lockForUpdate()->first();
            if (! $locked) {
                return;
            }

            // Release the promo slot this booking held — it is being cancelled
            // (no-runner / negotiate-expiry / admin) and will never complete, so
            // it must not keep burning a use. Runs for cash/unpaid too (there's
            // no money to refund, but the promo slot must still be freed).
            // Consumption-verified + idempotent (P0-7).
            $this->promoService->unredeem($locked->id);

            // Nothing was collected (cash/unpaid), or a racing call already
            // refunded it — either way there is nothing to return.
            if ($locked->payment_status !== 'paid') {
                return;
            }

            $refundable = round((float) $locked->total_amount, 2);
            if ($refundable > 0) {
                app(WalletService::class)->refund($locked->customer_id, $refundable, $locked->id);

                Payment::where('booking_id', $locked->id)
                    ->where('status', 'completed')
                    ->latest()
                    ->first()
                    ?->transitionTo(
                        PaymentStatus::Refunded,
                        actor: 'system',
                        reason: $reason,
                        meta: ['refunded_to' => 'wallet', 'unfulfilled' => true],
                        extra: [
                            'refund_amount' => $refundable,
                            'refunded_at' => now(),
                            // Honest record: money went to the wallet, not reversed to source.
                            'refunded_to' => 'wallet',
                        ],
                    );
            }

            $locked->update(['payment_status' => 'refunded']);
        });
    }

}
