<?php

namespace App\Http\Controllers;

use App\Support\ErrorCode;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Stubs for endpoints whose features are retired for launch, so the app build
 * already on phones gets a clear 422 instead of a 404 or a 500:
 *
 *   - saved cards and linked (one-tap) GCash/Maya/GrabPay accounts — every
 *     online payment is a one-time GCash or Maya charge now;
 *   - wallet top-ups — the wallet only spends a balance the customer already
 *     has (refunds and the like) and can be withdrawn;
 *   - the referral program;
 *   - the old dispute report (support chat replaced it), promo codes, the
 *     runner's open-offers list (offers come one at a time now) and the ride
 *     PIN check (rides are retired).
 *
 * Nothing here reads or writes data. Delete this controller and its routes
 * once the app update is out.
 */
class RetiredEndpointController extends Controller
{
    /**
     * GET /payments/methods. The app build already on phones only picks a
     * default payment method once this list has loaded, so it gets an empty
     * list — never the old linked accounts — rather than an error.
     */
    public function savedPaymentMethods(): JsonResponse
    {
        return $this->ok([]);
    }

    /** POST /payments/methods (saving a card, or a GCash/Maya token) */
    public function saveMethod(Request $request): JsonResponse
    {
        return $this->fail(
            ErrorCode::FEATURE_RETIRED,
            $request->input('type') === 'card'
                ? 'Card payments are no longer available — please pay with GCash, Maya or cash.'
                : 'Saved payment accounts are no longer available — please pay with GCash, Maya or cash.',
        );
    }

    /** POST /payments/methods/link */
    public function linkAccount(): JsonResponse
    {
        return $this->fail(
            ErrorCode::FEATURE_RETIRED,
            'Linking a GCash, Maya or GrabPay account is no longer available — you’ll pay with GCash or Maya at checkout each time.',
        );
    }

    /** DELETE /payments/methods/{id} and PUT /payments/methods/{id}/default */
    public function savedAccountAction(): JsonResponse
    {
        return $this->fail(
            ErrorCode::FEATURE_RETIRED,
            'Saved payment accounts are no longer available — please pay with GCash, Maya or cash.',
        );
    }

    /** POST /wallet/top-up */
    public function topUp(): JsonResponse
    {
        return $this->fail(
            ErrorCode::FEATURE_RETIRED,
            'Wallet top-ups are no longer available. You can still pay with GCash, Maya or cash, and spend any balance you already have.',
        );
    }

    /** GET /user/referral and POST /user/referral/apply */
    public function referral(): JsonResponse
    {
        return $this->fail(ErrorCode::FEATURE_RETIRED, 'The referral program has ended.');
    }

    /** POST /support/report (the retired dispute desk) */
    public function supportReport(): JsonResponse
    {
        return $this->fail(
            ErrorCode::FEATURE_RETIRED,
            'Reporting a problem here is no longer available — please message us in support chat in the app instead, and we’ll sort it out.',
        );
    }

    /** GET /promos/validate/{code} */
    public function promoCode(): JsonResponse
    {
        return $this->fail(ErrorCode::FEATURE_RETIRED, 'Promo codes are no longer available.');
    }

    /**
     * GET /runner/errand/available. There is no open list of errands to pick
     * from any more — each errand is offered to one runner at a time — so the
     * app build already on phones gets an empty list rather than an error.
     */
    public function availableErrands(): JsonResponse
    {
        return $this->ok([]);
    }

    /** POST /runner/errand/{id}/verify-pin */
    public function verifyRidePin(): JsonResponse
    {
        return $this->fail(ErrorCode::FEATURE_RETIRED, 'Rides are no longer available.');
    }
}
