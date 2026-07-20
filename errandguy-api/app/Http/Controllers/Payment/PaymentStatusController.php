<?php

namespace App\Http\Controllers\Payment;

use App\Http\Controllers\Controller;
use App\Models\Payment;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Cheap, authoritative status probe the mobile app polls to VERIFY a payment
 * (never to assume it). Returns only what the backend has actually confirmed —
 * no optimistic state. Ownership is scoped by customer_id so a poll can never
 * read another user's payment.
 */
class PaymentStatusController extends Controller
{
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
        $payment = Payment::where('customer_id', $request->user()->id)
            ->where('booking_id', $bookingId)
            ->with('booking:id,booking_number,payment_status')
            ->latest('created_at')
            ->firstOrFail();

        return response()->json([
            'data' => $this->present($payment),
        ]);
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

        return [
            'payment_id' => $payment->id,
            'status' => $payment->status,
            'booking_id' => $payment->booking_id,
            'booking_payment_status' => $payment->booking?->payment_status,
            'amount' => (float) $payment->amount,
            'method' => $payment->method,
            'reference' => $payment->gateway_tx_id ?? $payment->booking?->booking_number,
            'paid_at' => optional($payment->paid_at)->toIso8601String(),
            'failure_reason' => in_array($payment->status, ['failed', 'expired'], true) ? $failureReason : null,
        ];
    }
}
