<?php

namespace App\Http\Controllers\Payment;

use App\Http\Controllers\Controller;
use App\Http\Resources\PaymentResource;
use App\Models\Payment;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PaymentHistoryController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $payments = Payment::where('customer_id', $request->user()->id)
            ->with(['booking:id,booking_number,errand_type_id,status'])
            ->orderByDesc('created_at')
            ->paginate($request->integer('per_page', 20));

        return response()->json(
            PaymentResource::collection($payments)->response()->getData(true)
        );
    }

    public function receipt(Request $request, string $id): JsonResponse
    {
        $payment = Payment::where('customer_id', $request->user()->id)
            ->with(['booking.errandType', 'booking.runner'])
            ->findOrFail($id);

        return response()->json([
            'data' => [
                'payment' => new PaymentResource($payment),
                'booking' => [
                    'booking_number' => $payment->booking->booking_number ?? null,
                    'errand_type' => $payment->booking->errandType->name ?? null,
                    'pickup_address' => $payment->booking->pickup_address ?? null,
                    'dropoff_address' => $payment->booking->dropoff_address ?? null,
                    'runner_name' => $payment->booking->runner->full_name ?? null,
                    'completed_at' => $payment->booking->completed_at,
                ],
            ],
        ]);
    }
}
