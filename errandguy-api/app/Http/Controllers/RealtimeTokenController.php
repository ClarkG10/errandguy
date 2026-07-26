<?php

namespace App\Http\Controllers;

use App\Services\SupabaseTokenService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /realtime-token — issue a short-lived Supabase realtime JWT for the
 * authenticated user so the mobile client can subscribe as role=authenticated
 * (audit P6).
 *
 * INERT BY DEFAULT: `token` is null until SUPABASE_JWT_SECRET is configured, so
 * the client no-ops and realtime stays on its current anon/polling behavior.
 */
class RealtimeTokenController extends Controller
{
    public function __construct(private SupabaseTokenService $tokens) {}

    public function issue(Request $request): JsonResponse
    {
        $ttl = 3600;
        $token = $this->tokens->mint($request->user(), $ttl);

        return response()->json([
            'data' => [
                'token' => $token,                    // null ⇒ realtime auth disabled
                'expires_in' => $token ? $ttl : null,
            ],
        ]);
    }
}
