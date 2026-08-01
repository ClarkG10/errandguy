<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Conditional-GET support for the high-frequency, fat read endpoints the
 * mobile client polls (live-tracking, the runner feed, an active errand,
 * notification lists). It hashes the JSON body into an `ETag`, and when the
 * client echoes that hash back in `If-None-Match` — meaning it already holds
 * this exact payload — the response collapses to a bodyless `304 Not Modified`.
 *
 * What this buys, honestly:
 *   • WAF/network egress + on-device JSON parse are skipped when nothing
 *     changed between polls — which is the common case for a stationary trip
 *     or an idle feed, and doubly so during a realtime-broadcast outage when
 *     the client falls back to a tight REST poll.
 * What it does NOT buy:
 *   • the controller query still runs and the body is still serialized here to
 *     be hashed — so this saves bandwidth and client CPU, not server DB/CPU.
 *     (A version-key short-circuit that avoids the query is a later step.)
 *
 * Applied per-route (alias `etag`) rather than globally so the blast radius is
 * limited to endpoints whose payloads are deterministic given DB state +
 * request params (no per-request volatile fields, or the ETag would never
 * match and 304 would never fire). Routes that already set their own ETag
 * (e.g. the public /errand-types catalog) are left untouched.
 */
class EtagConditional
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        // Only conditionalize a cacheable method (GET/HEAD) returning a real,
        // in-memory 200 body. Streamed/binary responses (PDF exports) return
        // false from getContent() and are skipped. A route that already
        // stamped an ETag keeps it.
        if (
            ! $request->isMethodCacheable()
            || $response->getStatusCode() !== 200
            || $response->headers->has('ETag')
        ) {
            return $response;
        }

        $content = $response->getContent();
        if ($content === false || $content === '') {
            return $response;
        }

        $response->setEtag(md5($content));

        // Flip to a bodyless 304 when the client's If-None-Match matches the
        // freshly-computed tag. Symfony strips the body + content headers and
        // sets the 304 status; the validators (ETag) are preserved so the next
        // poll can revalidate again.
        $response->isNotModified($request);

        return $response;
    }
}
