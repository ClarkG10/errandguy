<?php

namespace App\Http\Controllers\Payment;

use App\Http\Controllers\Controller;
use App\Models\Booking;
use App\Models\Payment;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class PayMongoWebhookController extends Controller
{
    public function handle(Request $request): JsonResponse
    {
        $payload = $request->all();
        $sigHeader = $request->header('Paymongo-Signature');
        $secret = config('services.paymongo.webhook_secret');

        // Always enforce signature verification — reject if missing
        if (!$sigHeader || !$secret) {
            Log::warning('PayMongo webhook: missing signature header or secret');
            return response()->json(['error' => 'Signature verification required'], 400);
        }

        $parts = collect(explode(',', $sigHeader))
            ->mapWithKeys(function ($part) {
                [$key, $value] = explode('=', $part, 2);
                return [$key => $value];
            });

        $timestamp = $parts->get('t');
        $signature = $parts->get('te') ?? $parts->get('li');

        if (!$timestamp || !$signature) {
            Log::warning('PayMongo webhook: malformed signature header');
            return response()->json(['error' => 'Malformed signature'], 400);
        }

        $signedPayload = "{$timestamp}." . json_encode($payload);
        $expected = hash_hmac('sha256', $signedPayload, $secret);

        if (!hash_equals($expected, $signature)) {
            Log::warning('PayMongo webhook signature verification failed');
            return response()->json(['error' => 'Invalid signature'], 400);
        }

        $eventType = $payload['data']['attributes']['type'] ?? null;
        $resource = $payload['data']['attributes']['data'] ?? null;

        if (!$eventType || !$resource) {
            return response()->json(['error' => 'Invalid payload'], 400);
        }

        match ($eventType) {
            'payment.paid' => $this->handlePaymentPaid($resource),
            'payment.failed' => $this->handlePaymentFailed($resource),
            'source.chargeable' => $this->handleSourceChargeable($resource),
            default => null,
        };

        return response()->json(['status' => 'ok']);
    }

    private function handlePaymentPaid(array $resource): void
    {
        $paymentId = $resource['id'] ?? null;
        if (!$paymentId) {
            return;
        }

        DB::transaction(function () use ($paymentId, $resource) {
            $payment = Payment::where('gateway_tx_id', $paymentId)
                ->lockForUpdate()
                ->first();

            if (!$payment || $payment->status === 'completed') {
                return; // Idempotency: skip if already processed
            }

            $payment->update([
                'status' => 'completed',
                'paid_at' => now(),
                'gateway_response' => $resource,
            ]);
        });
    }

    private function handlePaymentFailed(array $resource): void
    {
        $paymentId = $resource['id'] ?? null;
        if (!$paymentId) {
            return;
        }

        DB::transaction(function () use ($paymentId, $resource) {
            $payment = Payment::where('gateway_tx_id', $paymentId)
                ->lockForUpdate()
                ->first();

            if (!$payment || in_array($payment->status, ['completed', 'failed'])) {
                return; // Idempotency: skip if already in terminal state
            }

            $payment->update([
                'status' => 'failed',
                'gateway_response' => $resource,
            ]);
        });
    }

    private function handleSourceChargeable(array $resource): void
    {
        $sourceId = $resource['id'] ?? null;
        if (!$sourceId) {
            return;
        }

        $payment = Payment::where('gateway_tx_id', $sourceId)->first();
        if (!$payment) {
            return;
        }

        $payment->update([
            'status' => 'processing',
            'gateway_response' => $resource,
        ]);
    }
}
