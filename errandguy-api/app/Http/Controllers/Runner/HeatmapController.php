<?php

namespace App\Http\Controllers\Runner;

use App\Http\Controllers\Controller;
use App\Models\Booking;
use App\Services\CacheService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Read-only demand aggregates that help runners position themselves.
 *
 * Both endpoints are derived purely from the bookings table (pickup geo +
 * created_at) and are the same for every runner, so they are cached with a
 * stale-while-revalidate window (~15m) to keep the heavy GROUP BY off the
 * hot path.
 */
class HeatmapController extends Controller
{
    /** SWR soft / hard TTL (seconds): fresh for 15m, physically kept for 30m. */
    private const SWR_SOFT = 900;
    private const SWR_HARD = 1800;

    /**
     * GET /runner/heatmap?days=14
     *
     * Buckets recent bookings into ~110m geo cells (lat/lng rounded to 3dp)
     * and returns each cell's booking count as a weight:
     *   [ { lat, lng, weight }, ... ]
     */
    public function heatmap(Request $request): JsonResponse
    {
        $days = $this->clampDays($request->integer('days', 14), 90);

        $cells = CacheService::swr(
            "runner:heatmap:{$days}",
            self::SWR_SOFT,
            self::SWR_HARD,
            fn () => Booking::query()
                ->whereNotNull('pickup_lat')
                ->whereNotNull('pickup_lng')
                ->where('created_at', '>=', now()->subDays($days))
                ->selectRaw($this->roundExpr('pickup_lat') . ' as lat')
                ->selectRaw($this->roundExpr('pickup_lng') . ' as lng')
                ->selectRaw('count(*) as weight')
                ->groupByRaw($this->roundExpr('pickup_lat') . ', ' . $this->roundExpr('pickup_lng'))
                ->get()
                ->map(fn ($row) => [
                    'lat' => (float) $row->lat,
                    'lng' => (float) $row->lng,
                    'weight' => (int) $row->weight,
                ])
                ->all(),
        );

        return response()->json([
            'data' => [
                'days' => $days,
                'cells' => $cells,
            ],
        ]);
    }

    /**
     * GET /runner/peak-hours?days=30
     *
     * Builds a day-of-week × hour-of-day demand grid from booking creation
     * times. `grid` is a 7-row (Sun..Sat) × 24-column (00..23) matrix of
     * booking counts.
     */
    public function peakHours(Request $request): JsonResponse
    {
        $days = $this->clampDays($request->integer('days', 30), 90);

        $grid = CacheService::swr(
            "runner:peak_hours:{$days}",
            self::SWR_SOFT,
            self::SWR_HARD,
            function () use ($days) {
                $dowExpr = $this->dowExpr();
                $hourExpr = $this->hourExpr();
                $rows = Booking::query()
                    ->where('created_at', '>=', now()->subDays($days))
                    ->selectRaw("{$dowExpr} as dow")
                    ->selectRaw("{$hourExpr} as hour")
                    ->selectRaw('count(*) as c')
                    ->groupByRaw("{$dowExpr}, {$hourExpr}")
                    ->get();

                // 7 (dow: 0=Sun..6=Sat) × 24 (hour) grid, zero-filled.
                $grid = array_fill(0, 7, array_fill(0, 24, 0));
                foreach ($rows as $row) {
                    $dow = (int) $row->dow;
                    $hour = (int) $row->hour;
                    if ($dow >= 0 && $dow <= 6 && $hour >= 0 && $hour <= 23) {
                        $grid[$dow][$hour] = (int) $row->c;
                    }
                }

                return $grid;
            },
        );

        return response()->json([
            'data' => [
                'days' => $days,
                'grid' => $grid,
            ],
        ]);
    }

    private function clampDays(int $days, int $max): int
    {
        return max(1, min($days, $max));
    }

    /**
     * Driver-portable SQL fragments. Production runs on MySQL; the test suite
     * runs on in-memory SQLite; a Postgres arm is kept for portability.
     * All three day-of-week expressions return 0=Sunday..6=Saturday and all
     * hour expressions return 0..23, so the resulting grid is identical across
     * drivers.
     */
    private function driver(): string
    {
        return Booking::query()->getConnection()->getDriverName();
    }

    private function roundExpr(string $col): string
    {
        // round(col, 3) is valid on MySQL and SQLite alike; Postgres needs the
        // ::numeric cast.
        return $this->driver() === 'pgsql'
            ? "round({$col}::numeric, 3)"
            : "round({$col}, 3)";
    }

    private function dowExpr(): string
    {
        return match ($this->driver()) {
            'pgsql' => 'extract(dow from created_at)',
            // MySQL DAYOFWEEK() is 1=Sun..7=Sat; shift to 0=Sun..6=Sat.
            'mysql', 'mariadb' => '(dayofweek(created_at) - 1)',
            default => "cast(strftime('%w', created_at) as integer)", // sqlite
        };
    }

    private function hourExpr(): string
    {
        return match ($this->driver()) {
            'pgsql' => 'extract(hour from created_at)',
            'mysql', 'mariadb' => 'hour(created_at)',
            default => "cast(strftime('%H', created_at) as integer)", // sqlite
        };
    }
}
