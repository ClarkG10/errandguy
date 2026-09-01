<?php

namespace App\Http\Controllers\Runner;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /runner/home — the runner dashboard in ONE authenticated round trip.
 *
 * The runner side never got the treatment the customer side did (see
 * {@see \App\Http\Controllers\Customer\HomeController}). Login warm-up still
 * awaits SIX separate authenticated GETs before the success curtain lifts
 * (/runner/profile, /runner/earnings?period=today, /runner/earnings?period=this_week,
 * /runner/errands/history, /runner/errand/available, /runner/errand/current)
 * and the dashboard then declares a seventh on mount (/runner/peak-hours) —
 * each paying a full framework boot + Sanctum auth on Forge. This endpoint
 * returns all seven sections at once so the client can seed its EXISTING
 * useQuery cache keys from a single response.
 *
 * SHAPE CONTRACT (the whole point — the client seeds per-section caches from
 * this payload, so any drift silently poisons them): every section is EXACTLY
 * what the corresponding individual endpoint puts inside its own `data`
 * envelope today. That is enforced structurally, not by hand: each section is
 * produced by INVOKING the very controller method that serves the individual
 * route and unwrapping its `data` key, so the eager-loads, resource classes
 * and conditional fields can never diverge.
 *
 * Client cache keys this payload seeds (all `[..., userId]` except peak-hours,
 * which is shared across runners and keyed WITHOUT a userId):
 *   profile           → ['runner','profile',userId]
 *   earnings_today    → ['runner','earnings','today',userId]
 *   earnings_week     → ['runner','earnings','week',userId]   (API period 'this_week')
 *   recent_errands    → ['runner','errands','recent',userId]
 *   available_errands → ['runner','errand','available',userId]
 *   current_errand    → ['runner','errand','current',userId]
 *   peak_hours        → ['runner','peak-hours',30]
 *
 * The individual endpoints stay exactly as they are; they remain the
 * per-screen revalidation paths. This is additive and read-only — no money
 * semantics anywhere.
 *
 * @see \Tests\Feature\Runner\RunnerHomeAggregateTest for the parity test.
 */
class RunnerHomeController extends Controller
{
    /**
     * How many recent errands the dashboard list needs. Fixed server-side so
     * the aggregate is a stable snapshot rather than a client-tunable list
     * (mirrors HomeController::RECENT_BOOKINGS).
     */
    private const RECENT_ERRANDS = 3;

    /**
     * Peak-hours window, in days. Pinned to the value the app asks for, because
     * the client cache key it seeds embeds the window (['runner','peak-hours',30])
     * and a different window under that key is simply the wrong data.
     */
    private const PEAK_HOURS_DAYS = 30;

    public function show(Request $request): JsonResponse
    {
        $user = $request->user();

        // Laravel resolves the paginator's page from the CURRENT request, so a
        // stray ?page= on the aggregate would silently shift recent_errands off
        // page 1. This endpoint takes no pagination input — drop it. It has to
        // come out of BOTH bags: SanitizeInput mirrors `$request->all()` back
        // through merge(), which lands query params in the input source too
        // (the JSON bag for an application/json request).
        $request->query->remove('page');
        $request->request->remove('page');
        if ($request->isJson()) {
            $request->json()->remove('page');
        }

        // Every delegate below that reads input off the request gets a
        // purpose-built one, so the aggregate's own query string can neither
        // reshape a section (period / days / per_page / status filters) nor
        // 422 the whole payload through a delegate's own validate().
        $earningsToday = $this->subRequest('/api/v1/runner/earnings', ['period' => 'today'], $user);
        $earningsWeek = $this->subRequest('/api/v1/runner/earnings', ['period' => 'this_week'], $user);
        $recentRequest = $this->subRequest('/api/v1/runner/errands/history', ['per_page' => self::RECENT_ERRANDS], $user);
        $peakRequest = $this->subRequest('/api/v1/runner/peak-hours', ['days' => self::PEAK_HOURS_DAYS], $user);

        $earnings = app(RunnerEarningsController::class);
        $errands = app(RunnerErrandController::class);

        // Order matters here, which is why the profile section is resolved
        // BEFORE the array literal rather than inside it: a runner with no
        // runner_profiles row gets one auto-created by
        // RunnerProfileController::show — and RunnerEarningsController::summary
        // would auto-create it too. Both read `$user->runnerProfile` off the
        // SAME user instance, so without re-loading the relation the second
        // delegate still sees it cached as null and inserts a duplicate row
        // (unique user_id → 500). Re-load once, and every later delegate sees
        // the row that now exists.
        $profile = $this->section(app(RunnerProfileController::class)->show($request));
        $user->load('runnerProfile');

        return $this->ok([
            'profile' => $profile,
            'earnings_today' => $this->section($earnings->summary($earningsToday)),
            'earnings_week' => $this->section($earnings->summary($earningsWeek)),
            'recent_errands' => $this->section(app(RunnerErrandHistoryController::class)->index($recentRequest)) ?? [],
            // available() legitimately returns [] for an OFFLINE runner
            // (RunnerErrandController::available). The key must still be SEEDED
            // with that empty list rather than omitted — the offer feed showing
            // "no offers" is the correct cold state, and a missing key just
            // costs the screen the round trip this endpoint exists to save.
            'available_errands' => $this->section($errands->available($request)) ?? [],
            'current_errand' => $this->section($errands->current($request)),
            // Shared across every runner and cached server-side under
            // `runner:peak_hours:30` (CacheService::swr, 15m soft / 30m hard),
            // so this section is a cache read, not a second GROUP BY.
            'peak_hours' => $this->section(app(HeatmapController::class)->peakHours($peakRequest)),
        ]);
    }

    /**
     * A purpose-built request for a delegate that reads input off the request,
     * carrying the aggregate's authenticated user.
     *
     * @param array<string,mixed> $query
     */
    private function subRequest(string $uri, array $query, mixed $user): Request
    {
        $sub = Request::create($uri, 'GET', $query);
        $sub->setUserResolver(fn () => $user);

        return $sub;
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
