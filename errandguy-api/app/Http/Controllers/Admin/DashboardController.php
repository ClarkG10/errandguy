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
                    'today' => Booking::whereDate('created_at', today())->count(),
                    'active' => Booking::whereNotIn('status', ['completed', 'cancelled'])->count(),
                    'completed_today' => Booking::where('status', 'completed')
                        ->whereDate('completed_at', today())->count(),
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
