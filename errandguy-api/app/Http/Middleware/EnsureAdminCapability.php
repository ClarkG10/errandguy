<?php

namespace App\Http\Middleware;

use App\Models\AdminUser;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Gate an admin API route by capability, mirroring the Filament role matrix
 * (AdminUser::canManageMoney/canHandleSupport/canManageSystem) so the REST admin
 * API and the Filament panel enforce the SAME authorization. Runs AFTER the
 * `admin` middleware, which already guarantees an active AdminUser — this only
 * adds the role check the base gate was missing (any active admin, regardless of
 * role, could previously move money via this API).
 *
 * Usage: ->middleware('admin.can:money' | 'admin.can:support' | 'admin.can:system')
 */
class EnsureAdminCapability
{
    public function handle(Request $request, Closure $next, string $capability): Response
    {
        /** @var AdminUser|null $user */
        $user = $request->user();

        $allowed = $user instanceof AdminUser && match ($capability) {
            'money' => $user->canManageMoney(),
            'support' => $user->canHandleSupport(),
            'moderate' => $user->canModerate(),
            'system' => $user->canManageSystem(),
            default => false,
        };

        if (! $allowed) {
            return response()->json([
                'success' => false,
                'message' => 'Forbidden. Your admin role is not permitted to perform this action.',
            ], 403);
        }

        return $next($request);
    }
}
