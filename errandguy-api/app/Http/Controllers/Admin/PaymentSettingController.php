<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\PaymentMethodCatalog;
use App\Support\AdminActivity;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Admin management of the available payment methods.
 *
 * GET  → full catalog annotated with which methods are currently enabled.
 * PUT  → set the enabled methods (operator turns GCash/Maya/Card/Wallet/Cash
 *        on or off without a deploy). At least one must stay enabled.
 */
class PaymentSettingController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json([
            'data' => PaymentMethodCatalog::catalogWithState(),
        ]);
    }

    public function update(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'methods' => ['required', 'array', 'min:1'],
            'methods.*' => ['string', 'in:' . implode(',', PaymentMethodCatalog::allTypes())],
        ]);

        $enabled = PaymentMethodCatalog::setEnabled(
            $validated['methods'],
            $request->user()?->id,
        );

        AdminActivity::log('payment_methods.updated', null, ['methods' => $validated['methods'], 'via' => 'api']);

        return response()->json([
            'data' => PaymentMethodCatalog::catalogWithState(),
            'enabled' => $enabled,
            'message' => 'Available payment methods updated.',
        ]);
    }
}
