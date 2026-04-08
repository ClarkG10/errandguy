<?php

namespace App\Http\Controllers\Payment;

use App\Http\Controllers\Controller;
use App\Models\PaymentMethod;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PaymentMethodController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $methods = PaymentMethod::where('user_id', $request->user()->id)
            ->orderByDesc('is_default')
            ->orderBy('created_at')
            ->get()
            ->makeHidden(['gateway_token']);

        return response()->json([
            'data' => $methods,
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'type' => ['required', 'string', 'in:card,gcash,maya'],
            'gateway_token' => ['required', 'string', 'max:500'],
            'label' => ['nullable', 'string', 'max:100'],
            'last_four' => ['nullable', 'string', 'max:4'],
            'card_brand' => ['nullable', 'string', 'max:20'],
            'expires_at' => ['nullable', 'date'],
        ]);

        $user = $request->user();

        $isFirst = !PaymentMethod::where('user_id', $user->id)->exists();

        $method = PaymentMethod::create([
            'user_id' => $user->id,
            'type' => $validated['type'],
            'gateway_token' => $validated['gateway_token'],
            'label' => $validated['label'] ?? ucfirst($validated['type']),
            'last_four' => $validated['last_four'] ?? null,
            'card_brand' => $validated['card_brand'] ?? null,
            'expires_at' => $validated['expires_at'] ?? null,
            'is_default' => $isFirst,
        ]);

        return response()->json([
            'data' => $method->makeHidden(['gateway_token']),
        ], 201);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $method = PaymentMethod::where('user_id', $request->user()->id)
            ->findOrFail($id);

        $wasDefault = $method->is_default;
        $method->delete();

        if ($wasDefault) {
            PaymentMethod::where('user_id', $request->user()->id)
                ->orderBy('created_at')
                ->first()
                ?->update(['is_default' => true]);
        }

        return response()->json([
            'message' => 'Payment method removed.',
        ]);
    }

    public function setDefault(Request $request, string $id): JsonResponse
    {
        $user = $request->user();

        PaymentMethod::where('user_id', $user->id)
            ->update(['is_default' => false]);

        PaymentMethod::where('user_id', $user->id)
            ->where('id', $id)
            ->update(['is_default' => true]);

        return response()->json([
            'message' => 'Default payment method updated.',
        ]);
    }
}
