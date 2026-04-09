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

        if (!$event) {
            return response()->json(['error' => 'Invalid payload'], 400);
        }

        match ($event) {
            'payment.succeeded' => $this->handlePaymentSucceeded($payload['data'] ?? []),
            'payment.failed' => $this->handlePaymentFailed($payload['data'] ?? []),
            'payment.pending' => $this->handlePaymentPending($payload['data'] ?? []),
            'refund.succeeded' => $this->handleRefundSucceeded($payload['data'] ?? []),
            default => null,
        };

        return response()->json(['status' => 'ok']);
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
