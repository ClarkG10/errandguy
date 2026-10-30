<?php

namespace App\Http\Controllers\Payment;

use App\Http\Controllers\Controller;
use App\Services\CacheService;
use App\Services\PaymentMethodCatalog;
use Illuminate\Http\JsonResponse;

class PaymentMethodController extends Controller
{
    /**
     * The payment methods currently OFFERED by the platform (operator-managed
     * via admin): cash, GCash, Maya and the wallet. The app renders exactly
     * this set in its selector so a disabled or retired method never appears.
     * Cached with background refresh.
     */
    public function available(): JsonResponse
    {
        return $this->ok(CacheService::swr(
            'payments:available_methods',
            300,   // fresh 5 min
            3600,  // survive 1 h
            fn () => PaymentMethodCatalog::enabled(),
        ));
    }
}
