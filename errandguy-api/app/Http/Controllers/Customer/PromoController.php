<?php

namespace App\Http\Controllers\Customer;

use App\Http\Controllers\Controller;
use App\Http\Resources\PromoResource;
use App\Models\PromoCode;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PromoController extends Controller
{
    /**
     * List promo codes the current user can currently redeem: active,
     * inside their validity window, and not globally exhausted (scopeValid).
     * Codes the user has already redeemed up to their per-user limit are
     * excluded via a cheap correlated count against their bookings.
     */
    public function index(Request $request): JsonResponse
    {
        $userId = $request->user()->id;

        $promos = PromoCode::valid()
            ->whereRaw(
                'per_user_limit > (select count(*) from bookings where bookings.promo_code_id = promo_codes.id and bookings.customer_id = ?)',
                [$userId]
            )
            ->orderByDesc('valid_from')
            ->get();

        return response()->json([
            'data' => PromoResource::collection($promos),
        ]);
    }
}
