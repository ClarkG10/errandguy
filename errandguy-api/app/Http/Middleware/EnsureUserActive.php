<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureUserActive
{
    /**
     * Ensure the authenticated user's account is active.
     * Updates last_active_at on each request.
     */
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (!$user) {
            return response()->json([
                'success' => false,
                'message' => 'Unauthenticated.',
            ], 401);
        }

        if ($user->status === 'suspended') {
            return response()->json([
                'success' => false,
                'message' => 'Your account has been suspended. Please contact support.',
            ], 403);
        }

        if ($user->status === 'banned') {
            return response()->json([
                'success' => false,
                'message' => 'Your account has been permanently banned.',
            ], 403);
        }

        if ($user->status === 'deleted') {
            return response()->json([
                'success' => false,
                'message' => 'This account no longer exists.',
            ], 403);
        }

        // Update last active timestamp
        $user->update(['last_active_at' => now()]);

        return $next($request);
    }
}
