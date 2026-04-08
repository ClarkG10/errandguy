<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class RoleMiddleware
{
    /**
     * Handle an incoming request.
     * Usage: middleware('role:customer') or middleware('role:runner')
     */
    public function handle(Request $request, Closure $next, string $role): Response
    {
        $user = $request->user();

        if (!$user || $user->role !== $role) {
            return response()->json([
                'success' => false,
                'message' => 'Unauthorized. This action requires the ' . $role . ' role.',
            ], 403);
        }

        return $next($request);
    }
}
