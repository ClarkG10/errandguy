<?php

namespace App\Http\Controllers\Payment;

use App\Http\Controllers\Controller;
use App\Models\Payment;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class XenditWebhookController extends Controller
{
    public function handle(Request $request): JsonResponse
    {
        $payload = $request->all();
        $callbackToken = $request->header('x-callback-token');
        $expectedToken = config('services.xendit.webhook_token');

        if (!$callbackToken || !$expectedToken) {
            Log::warning('Xendit webhook: missing callback token or config');
            return response()->json(['error' => 'Token verification required'], 400);
        }

        if (!hash_equals($expectedToken, $callbackToken)) {
            Log::warning('Xendit webhook: token verification failed');
            return response()->json(['error' => 'Invalid token'], 400);
        }

        $event = $payload['event'] ?? null;

        // Newer "Payments" webhooks (payment_requests, refunds, and some
        // invoice setups) wrap everything as {event, data}.
        if ($event) {
            match ($event) {
                'payment.succeeded' => $this->handlePaymentSucceeded($payload['data'] ?? []),
                'payment.failed' => $this->handlePaymentFailed($payload['data'] ?? []),
                'payment.pending' => $this->handlePaymentPending($payload['data'] ?? []),
                'refund.succeeded' => $this->handleRefundSucceeded($payload['data'] ?? []),
                // v2 invoices (used for wallet top-ups) may fire this event.
                'invoice.paid' => $this->handleInvoicePaid($payload['data'] ?? $payload),
                // Linked e-wallet lifecycle (Stage 2 saved methods).
                'payment_method.activated' => $this->handlePaymentMethodStatus($payload['data'] ?? [], 'active'),
                'payment_method.expired' => $this->handlePaymentMethodStatus($payload['data'] ?? [], 'expired'),
                'payment_method.failed' => $this->handlePaymentMethodStatus($payload['data'] ?? [], 'failed'),
                default => null,
            };

            return response()->json(['status' => 'ok']);
        }

        // Classic Xendit INVOICE webhook: the invoice object is POSTed FLAT at
        // the top level — no `event`/`data` wrapper, just fields like
        // { id, external_id, status: "PAID", amount, ... }. This is what the
        // dashboard "Test" button and real invoice callbacks send.
        if (isset($payload['external_id'], $payload['status'])) {
            $status = strtoupper((string) $payload['status']);
            if (in_array($status, ['PAID', 'SETTLED'], true)) {
                $this->handleInvoicePaid($payload);
            }
            // Other statuses (EXPIRED, etc.) — acknowledge without action so
            // Xendit stops retrying.
            return response()->json(['status' => 'ok']);
        }

        return response()->json(['error' => 'Invalid payload'], 400);
    }

    /**
     * Invoice paid — currently used for wallet top-ups. The invoice's
     * external_id is "topup-{walletTransactionId}"; credit that pending
     * transaction (idempotently) via the WalletService.
     */
    private function handleInvoicePaid(array $data): void
    {
        $externalId = $data['external_id'] ?? null;
        if (!$externalId) {
            return;
        }

        if (str_starts_with($externalId, 'topup-')) {
            $transactionId = substr($externalId, 6);
            app(\App\Services\WalletService::class)->completeTopUp($transactionId, $data);
            return;
        }

        if (str_starts_with($externalId, 'booking-')) {
            $paymentId = substr($externalId, 8);
            DB::transaction(function () use ($paymentId, $data) {
                $payment = Payment::where('id', $paymentId)->lockForUpdate()->first();
                if (!$payment || $payment->status === 'completed') {
                    return;
                }
                $payment->update([
                    'status' => 'completed',
                    'paid_at' => now(),
                    'gateway_response' => $data,
                ]);
                // Mark the booking paid so the customer/runner UIs reflect it.
                if ($payment->booking) {
                    $payment->booking->update(['payment_status' => 'paid']);
                }
            });
        }
    }

    /**
     * Linked e-wallet lifecycle. Xendit sends the payment-method object; its
     * `id` is what we stored as gateway_ref when the customer started linking.
     */
    private function handlePaymentMethodStatus(array $data, string $status): void
    {
        $id = $data['id'] ?? null;
        if (! $id) {
            return;
        }

        \App\Models\PaymentMethod::where('gateway_ref', $id)->update(['status' => $status]);
    }

    private function handlePaymentSucceeded(array $data): void
    {
        $paymentRequestId = $data['payment_request_id'] ?? null;
        if (!$paymentRequestId) {
            return;
        }

        DB::transaction(function () use ($paymentRequestId, $data) {
            $payment = Payment::where('gateway_tx_id', $paymentRequestId)
                ->lockForUpdate()
                ->first();

            if (!$payment || $payment->status === 'completed') {
                return;
            }

            $payment->update([
                'status' => 'completed',
                'paid_at' => now(),
                'gateway_response' => $data,
            ]);

            // Saved-method / payment-request charges are tied to a booking —
            // mark it paid so the customer/runner UIs reflect it.
            if ($payment->booking) {
                $payment->booking->update(['payment_status' => 'paid']);
            }
        });
    }

    private function handlePaymentFailed(array $data): void
    {
        $paymentRequestId = $data['payment_request_id'] ?? null;
        if (!$paymentRequestId) {
            return;
        }

        DB::transaction(function () use ($paymentRequestId, $data) {
            $payment = Payment::where('gateway_tx_id', $paymentRequestId)
                ->lockForUpdate()
                ->first();

            if (!$payment || in_array($payment->status, ['completed', 'failed'])) {
                return;
            }

            $payment->update([
                'status' => 'failed',
                'gateway_response' => $data,
            ]);
        });
    }

    private function handlePaymentPending(array $data): void
    {
        $paymentRequestId = $data['payment_request_id'] ?? null;
        if (!$paymentRequestId) {
            return;
        }

        $payment = Payment::where('gateway_tx_id', $paymentRequestId)->first();
        if (!$payment) {
            return;
        }

        $payment->update([
            'status' => 'processing',
            'gateway_response' => $data,
        ]);
    }

    private function handleRefundSucceeded(array $data): void
    {
        $referenceId = $data['reference_id'] ?? null;
        if (!$referenceId || !str_starts_with($referenceId, 'refund-')) {
            return;
        }

        $paymentId = substr($referenceId, 7);

        DB::transaction(function () use ($paymentId, $data) {
            $payment = Payment::where('id', $paymentId)
                ->lockForUpdate()
                ->first();

            if (!$payment || $payment->status === 'refunded') {
                return;
            }

            $payment->update([
                'status' => 'refunded',
                'refund_amount' => ($data['amount'] ?? $payment->amount),
                'refunded_at' => now(),
                'gateway_response' => $data,
            ]);
        });
    }
}
