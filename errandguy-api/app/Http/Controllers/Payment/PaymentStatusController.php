<?php

namespace App\Http\Controllers\Payment;

use App\Http\Controllers\Controller;
use App\Models\Booking;
use App\Models\Payment;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Cheap, authoritative status probe the mobile app polls to VERIFY a payment
 * (never to assume it). Returns only what the backend has actually confirmed —
 * no optimistic state. Ownership is scoped by customer_id so a poll can never
 * read another user's payment.
 *
 * Contract (shared with WalletController::transactionStatus for top-ups):
 *   kind          'payment' here, 'wallet_topup' for top-up probes
 *   id            the settling row's id (canonical; payment_id kept as alias)
 *   status        the ONE success token is 'completed'; pending/processing are
 *                 non-terminal; failed/expired/cancelled/refunded are terminal
 *                 failures. Never rename 'completed' — the client keys on it.
 *   amount        float
 *   settled_at    ISO8601 settlement time (canonical; paid_at kept as alias)
 *   failure_reason populated for ALL terminal-failure states, else null
 */
class PaymentStatusController extends Controller
{
    /** Terminal states that represent a non-success outcome. */
    private const FAILURE_STATES = ['failed', 'expired', 'cancelled', 'refunded'];

    public function show(Request $request, string $id): JsonResponse
    {
        $payment = Payment::where('customer_id', $request->user()->id)
            ->with('booking:id,booking_number,payment_status')
            ->findOrFail($id);

        return response()->json([
            'data' => $this->present($payment),
        ]);
    }

    /**
     * Same shape, addressed by booking id (the app may only know the booking
     * when it lands on the deep-link screen).
     */
    public function forBooking(Request $request, string $bookingId): JsonResponse
    {
        $userId = $request->user()->id;

        $payment = Payment::where('customer_id', $userId)
            ->where('booking_id', $bookingId)
            ->with('booking:id,booking_number,payment_status')
            ->latest('created_at')
            ->first();

        if ($payment) {
            return response()->json(['data' => $this->present($payment)]);
        }

        // No payment row for this booking yet. Distinguish an honest pre-charge
        // "pending" (the booking exists and is the caller's) from a genuinely
        // unknown or foreign booking (404). The old firstOrFail() conflated the
        // two, so a legitimately-pending booking looked "not found" to a client
        // that could otherwise keep polling for a status.
        $booking = Booking::where('customer_id', $userId)
            ->where('id', $bookingId)
            ->firstOrFail(); // 404 only for unknown / foreign booking

        return response()->json(['data' => $this->presentPending($booking)]);
    }

    /**
     * @return array<string,mixed>
     */
    private function present(Payment $payment): array
    {
        // gateway_response is $hidden on the model, so reading the failure code
        // here (rather than serializing the model) keeps the raw gateway body
        // out of the response.
        $failureReason = data_get($payment->gateway_response, 'failure_code')
            ?? data_get($payment->gateway_response, 'failure_reason')
            ?? data_get($payment->gateway_response, 'status');

        $paidAt = optional($payment->paid_at)->toIso8601String();

        return [
            'kind' => 'payment',
            'id' => $payment->id,
            'payment_id' => $payment->id, // alias kept for existing clients
            'status' => $payment->status,
            'booking_id' => $payment->booking_id,
            'booking_payment_status' => $payment->booking?->payment_status,
            'amount' => (float) $payment->amount,
            'method' => $payment->method,
            'reference' => $payment->gateway_tx_id ?? $payment->booking?->booking_number,
            'settled_at' => $paidAt,
            'paid_at' => $paidAt, // alias kept for existing clients
            'failure_reason' => in_array($payment->status, self::FAILURE_STATES, true) ? $failureReason : null,
        ];
    }

    /**
     * A booking that exists but has not been charged yet — an honest "pending"
     * in the same shape as present(), with no settling row.
     *
     * @return array<string,mixed>
     */
    private function presentPending(Booking $booking): array
    {
        return [
            'kind' => 'payment',
            'id' => null,
            'payment_id' => null,
            'status' => 'pending',
            'booking_id' => $booking->id,
            'booking_payment_status' => $booking->payment_status,
            'amount' => (float) $booking->total_amount,
            'method' => $booking->payment_method,
            'reference' => $booking->booking_number,
            'settled_at' => null,
            'paid_at' => null,
            'failure_reason' => null,
        ];
    }
}
