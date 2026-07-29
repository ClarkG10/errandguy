<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

/**
 * Assigns a correlation id to every API request so a single request can be
 * traced across log lines, error envelopes, and (later) audit rows.
 *
 * • Reuses a well-formed inbound `X-Request-Id` (so a client or an upstream
 *   proxy can correlate), otherwise generates a UUID.
 * • Stashes it on the request attributes — {@see \App\Support\ApiPayload} reads
 *   it into `meta.request_id` on every response.
 * • Pushes it into the log context, so the existing `reportable()` logger and
 *   every `LogApiRequests` line gain `request_id` with no signature changes.
 * • Echoes it back in the `X-Request-Id` response header.
 *
 * Registered FIRST in the api group (before LogApiRequests) so the id exists
 * before anything logs or an exception renders.
 */
class AssignRequestId
{
    /** Reject junk/oversized inbound ids to keep logs clean and injection-safe. */
    private const VALID_INBOUND = '/^[A-Za-z0-9\-]{8,64}$/';

    public function handle(Request $request, Closure $next): Response
    {
        $inbound = $request->header('X-Request-Id');
        $id = (is_string($inbound) && preg_match(self::VALID_INBOUND, $inbound))
            ? $inbound
            : (string) Str::uuid();

        $request->attributes->set('request_id', $id);
        Log::withContext(['request_id' => $id]);

        $response = $next($request);
        $response->headers->set('X-Request-Id', $id);

        return $response;
    }
}
