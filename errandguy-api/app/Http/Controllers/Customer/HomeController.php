<?php

namespace App\Http\Controllers\Customer;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Payment\WalletController;
use App\Models\ErrandType;
use App\Services\CacheService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /customer/home — the customer dashboard in ONE authenticated round trip.
 *
 * The app's Home screen fires six separate authenticated GETs on every cold
 * start (/errand-types, /bookings?per_page=N, /bookings/active, /promos,
 * /wallet/balance, /user/referral), each paying a full framework boot +
 * Sanctum auth on Forge, and the login warm-up fires most of them a second
 * time. This endpoint returns all six sections at once so the client can seed
 * its existing useQuery cache keys from a single response.
 *
 * SHAPE CONTRACT (the whole point — the client seeds per-section caches from
 * this payload, so any drift silently poisons them): every section is EXACTLY
 * what the corresponding individual endpoint puts inside its own `data`
 * envelope today. That is enforced structurally, not by hand: each section is
 * produced by INVOKING the very controller method that serves the individual
 * route and unwrapping its `data` key, so the eager-loads, resource classes
 * and conditional fields can never diverge. The one exception is
 * `errand_types`, whose route is a closure — it reuses the same CacheService
 * SWR key/TTLs/query, so it literally reads the same cache entry.
 *
 * The individual endpoints stay exactly as they are; they remain the
 * per-screen revalidation paths. This is additive and read-only — no money
 * semantics anywhere.
 *
 * @see \Tests\Feature\Customer\CustomerHomeAggregateTest for the parity test.
 */
class HomeController extends Controller
{
    /**
     * How many recent bookings the Home list needs. Fixed server-side so the
     * aggregate is a stable snapshot rather than a client-tunable list.
     */
    private const RECENT_BOOKINGS = 5;

    public function show(Request $request): JsonResponse
    {
        $user = $request->user();

        // Laravel resolves the paginator's page from the CURRENT request, so a
        // stray ?page= on the aggregate would silently shift recent_bookings
        // off page 1. This endpoint takes no pagination input — drop it. It has
        // to come out of BOTH bags: SanitizeInput mirrors `$request->all()`
        // back through merge(), which lands query params in the input source
        // too (the JSON bag for an application/json request).
        $request->query->remove('page');
        $request->request->remove('page');
        if ($request->isJson()) {
            $request->json()->remove('page');
        }

        $bookings = app(BookingController::class);

        // BookingController::index reads per_page (and optional filters) off
        // the request. Hand it a purpose-built one so the aggregate's own
        // query string can't reshape the section.
        $recentRequest = Request::create('/api/v1/bookings', 'GET', ['per_page' => self::RECENT_BOOKINGS]);
        $recentRequest->setUserResolver(fn () => $user);

        $wallet = $this->section(app(WalletController::class)->balance($request));

        return $this->ok([
            // Same key, same soft/hard TTLs, same query as the public
            // /errand-types route — a shared cache entry, not a second one.
            'errand_types' => CacheService::swr(
                CacheService::errandTypesKey(),
                3600,
                86400,
                fn () => ErrandType::where('is_active', true)->orderBy('sort_order')->get()->toArray(),
            ),
            'active_booking' => $this->section($bookings->active($request)),
            'recent_bookings' => $this->section($bookings->index($recentRequest)) ?? [],
            // The NUMBER, not the {balance: n} object: the app's
            // ['wallet','balance',userId] cache key holds a plain number and
            // seeding the object poisons the wallet screen.
            'wallet_balance' => (float) ($wallet['balance'] ?? 0),
            'promos' => $this->section(app(PromoController::class)->index($request)) ?? [],
            'referral' => $this->section(app(ReferralController::class)->show($request)),
        ]);
    }

    /**
     * Unwrap the `data` key of a delegated controller response, giving the
     * section the exact serialized shape that endpoint ships today.
     */
    private function section(JsonResponse $response): mixed
    {
        $payload = $response->getData(true);

        return is_array($payload) ? ($payload['data'] ?? null) : null;
    }
}
