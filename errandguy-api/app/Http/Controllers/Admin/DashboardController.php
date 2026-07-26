<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Booking;
use App\Models\User;
use App\Models\RunnerProfile;
use App\Models\DisputeTicket;
use App\Services\CacheService;
use Illuminate\Http\JsonResponse;

class DashboardController extends Controller
{
    public function stats(): JsonResponse
    {
        $data = CacheService::remember('admin:dashboard:stats', function () {
            // Half-open [today, tomorrow) ranges instead of whereDate(): the DB
            // helper compiles to DATE(created_at) = ? which is non-sargable, so
            // idx_bookings_created_at / idx_bookings_runner_status_completed
            // can't be used and Postgres seq-scans the largest table. app.tz is
            // UTC and created_at/completed_at are stored UTC, so today()..addDay()
            // is exactly equivalent to the previous whereDate(created_at, today())
            // with no date-boundary shift. Each today() call returns a fresh
            // Carbon, so today()->addDay() does not mutate $todayStart.
            $todayStart = today();
            $tomorrowStart = today()->addDay();
            return [
                'users' => [
                    'total_customers' => User::where('role', 'customer')->count(),
                    'total_runners' => User::where('role', 'runner')->count(),
                    'active_today' => User::where('last_active_at', '>=', now()->startOfDay())->count(),
                ],
                'runners' => [
                    'online' => RunnerProfile::where('is_online', true)->count(),
                    'pending_verification' => RunnerProfile::where('verification_status', 'pending')->count(),
                ],
                'bookings' => [
                    'total' => Booking::count(),
                    'today' => Booking::where('created_at', '>=', $todayStart)
                        ->where('created_at', '<', $tomorrowStart)->count(),
                    'active' => Booking::whereNotIn('status', ['completed', 'cancelled'])->count(),
                    'completed_today' => Booking::where('status', 'completed')
                        ->where('completed_at', '>=', $todayStart)
                        ->where('completed_at', '<', $tomorrowStart)->count(),
                ],
                'disputes' => [
                    'active' => DisputeTicket::where('status', 'active')->count(),
                    'escalated' => DisputeTicket::where('status', 'escalated')->count(),
                ],
            ];
        });

        return response()->json(['data' => $data]);
    }
}
