<?php

namespace App\Support;

/**
 * The vehicle ladder a booking is priced on and a runner is matched against:
 * walk < bicycle < motorcycle < car.
 *
 * A customer pays for the vehicle they chose (PricingService adds a premium per
 * rung), so a runner may only take an errand booked at THEIR vehicle's rung or
 * below — a car runner can do a motorcycle job, a walker cannot do a car job.
 * MatchingService filters on this and RunnerErrandController::accept() checks it
 * again, so the two can never disagree.
 *
 * A runner with no vehicle on file is treated as walking, which is also what the
 * app shows them on their vehicle settings screen.
 */
final class VehicleClass
{
    public const LADDER = ['walk', 'bicycle', 'motorcycle', 'car'];

    private const LABELS = [
        'walk' => 'walking',
        'bicycle' => 'a bicycle',
        'motorcycle' => 'a motorcycle',
        'car' => 'a car',
    ];

    /** Position on the ladder; an unknown or missing vehicle ranks as walking. */
    public static function rank(?string $vehicle): int
    {
        $rank = array_search($vehicle, self::LADDER, true);

        return $rank === false ? 0 : $rank;
    }

    /**
     * The runner vehicles allowed to take an errand booked at $booked, or null
     * when any runner will do (a walking errand, or an older booking with no
     * vehicle recorded).
     *
     * @return list<string>|null
     */
    public static function eligibleRunnerVehicles(?string $booked): ?array
    {
        if (! in_array($booked, self::LADDER, true) || self::rank($booked) === 0) {
            return null;
        }

        return array_slice(self::LADDER, self::rank($booked));
    }

    public static function canServe(?string $runnerVehicle, ?string $booked): bool
    {
        $eligible = self::eligibleRunnerVehicles($booked);

        return $eligible === null || in_array($runnerVehicle, $eligible, true);
    }

    /** "a motorcycle", for runner-facing copy. */
    public static function label(?string $vehicle): string
    {
        return self::LABELS[$vehicle] ?? 'walking';
    }

    /** What an errand booked at $booked needs: "a motorcycle or a car". */
    public static function requirement(?string $booked): string
    {
        $labels = array_map(self::label(...), self::eligibleRunnerVehicles($booked) ?? self::LADDER);
        $last = array_pop($labels);

        return $labels === [] ? $last : implode(', ', $labels).' or '.$last;
    }
}
