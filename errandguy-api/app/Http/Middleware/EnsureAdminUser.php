<?php

namespace App\Http\Middleware;

use App\Models\AdminUser;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureAdminUser
{
    /**
     * Ensure the authenticated user is an AdminUser (not a regular User).
     * This prevents regular customers/runners from accessing admin endpoints
     * even if they have a valid Sanctum token.
     */
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (!$user || !($user instanceof AdminUser)) {
            return response()->json([
                'success' => false,
                'message' => 'Unauthorized. Admin access required.',
            ], 403);
        }

        if (!$user->is_active) {
            return response()->json([
                'success' => false,
                'message' => 'Admin account is deactivated.',
            ], 403);
        }

        return $next($request);
    }
}
