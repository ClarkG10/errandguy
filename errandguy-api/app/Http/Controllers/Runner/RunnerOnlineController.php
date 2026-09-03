<?php

namespace App\Http\Controllers\Runner;

use App\Http\Controllers\Controller;
use App\Http\Requests\Runner\ToggleOnlineRequest;
use Illuminate\Http\JsonResponse;

class RunnerOnlineController extends Controller
{
    public function toggle(ToggleOnlineRequest $request): JsonResponse
    {
        $profile = $request->user()->runnerProfile;

        if (!$profile) {
            return response()->json(['message' => 'Runner profile not found. Please complete onboarding.'], 404);
        }

        $validated = $request->validated();
        $goingOnline = (bool) $validated['is_online'];

        if ($goingOnline) {
            // Must be approved
            if ($profile->verification_status !== 'approved') {
                return response()->json([
                    'message' => 'Your account must be approved before going online.',
                ], 422);
            }

            // Must have at least 1 preferred errand type
            if (empty($profile->preferred_types)) {
                return response()->json([
                    'message' => 'Please set at least one preferred errand type before going online.',
                ], 422);
            }

            $profile->update([
                'is_online' => true,
                'current_lat' => $validated['lat'],
                'current_lng' => $validated['lng'],
                'last_location_at' => now(),
                // Stamp the shift start only on a genuine off→on transition.
                // The app re-asserts online on foreground/reconnect, and
                // resetting the clock there would silently restart the shift
                // every time the runner switched apps.
                'online_since' => $profile->is_online && $profile->online_since
                    ? $profile->online_since
                    : now(),
            ]);
        } else {
            // Check no active errand in progress
            $activeCount = $request->user()
                ->runnerBookings()
                ->whereNotIn('status', ['completed', 'cancelled', 'pending'])
                ->count();

            if ($activeCount > 0) {
                return response()->json([
                    'message' => 'You cannot go offline while you have an active errand.',
                ], 422);
            }

            // Read the shift start BEFORE clearing it.
            $shift = $this->shiftSummary($request->user(), $profile->online_since);

            $profile->update([
                'is_online' => false,
                'online_since' => null,
            ]);

            return response()->json([
                'data' => [
                    'is_online' => $profile->is_online,
                    // Null when we can't measure the shift honestly (a runner
                    // who was already online before online_since existed, or a
                    // stale toggle). The app renders nothing rather than a
                    // zeroed-out summary that reads like a bad day.
                    'shift' => $shift,
                ],
                'message' => 'You are now offline.',
            ]);
        }

        return response()->json([
            'data' => [
                'is_online' => $profile->is_online,
            ],
            'message' => 'You are now online.',
        ]);
    }

    /**
     * What the shift just ended actually amounted to.
     *
     * A runner clocked off into silence: to find out what they'd made they had
     * to go to the earnings tab and reason about which rows belonged to the
     * hours they'd just worked. This closes the shift with the figure they
     * actually want.
     *
     * The aggregate deliberately mirrors RunnerEarningsController::summary —
     * `runner_payout` summed, `tip_amount` summed ALONGSIDE it and never into
     * it, because runner_payout is what the cash-settlement commission maths
     * and the PDF statement reconcile against. A shift card that folded tips
     * into earnings would disagree with the earnings screen the runner checks
     * next, and there is no worse place to be approximately right than money.
     *
     * @return array<string,mixed>|null
     */
    private function shiftSummary($user, $onlineSince): ?array
    {
        if (! $onlineSince) {
            return null;
        }

        $agg = $user->runnerBookings()
            ->completed()
            ->where('completed_at', '>=', $onlineSince)
            ->selectRaw(
                'COALESCE(SUM(runner_payout), 0) as sum_payout, COALESCE(SUM(tip_amount), 0) as sum_tips, COUNT(*) as cnt'
            )
            ->first();

        return [
            'started_at' => $onlineSince->toIso8601String(),
            'ended_at' => now()->toIso8601String(),
            // Whole minutes: the client formats it, and a float of hours would
            // invite rounding that disagrees with the timestamps above.
            'minutes_online' => (int) $onlineSince->diffInMinutes(now()),
            'errands' => (int) ($agg->cnt ?? 0),
            'earnings' => round((float) ($agg->sum_payout ?? 0), 2),
            'tips' => round((float) ($agg->sum_tips ?? 0), 2),
        ];
    }
}
