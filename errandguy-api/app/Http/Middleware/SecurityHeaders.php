<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class SecurityHeaders
{
    /**
     * Add security headers to all API responses.
     *
     * The API only ever returns JSON (or 4xx/5xx HTML error pages from
     * the framework). Locking down CSP to `default-src 'none'` means
     * that even if a stack trace or validation error leaks into a
     * response body, no embedded `<script>`/`<img>`/`<iframe>` can
     * fetch anything when the response is opened in a browser. This
     * is a no-op for the mobile client (it parses JSON) but blocks
     * a real reflected-XSS escalation path on the web admin tooling
     * that proxies through the same API.
     */
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        $response->headers->set('X-Content-Type-Options', 'nosniff');
        $response->headers->set('X-Frame-Options', 'DENY');
        $response->headers->set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        $response->headers->set('Referrer-Policy', 'strict-origin-when-cross-origin');
        $response->headers->set('Permissions-Policy', 'geolocation=(self), camera=(self)');
        // API never serves HTML intentionally — pin everything down.
        $response->headers->set(
            'Content-Security-Policy',
            "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
        );
        $response->headers->set('Cross-Origin-Resource-Policy', 'same-site');

        // Authenticated API responses must never be cached by intermediate
        // proxies or the browser disk cache — tokens and PII would leak
        // across users on shared networks. Webhooks and the public trip
        // endpoint set their own cache headers downstream as needed.
        if ($request->user() !== null && !$response->headers->has('Cache-Control')) {
            $response->headers->set('Cache-Control', 'no-store, private');
            $response->headers->set('Pragma', 'no-cache');
        }

        return $response;
    }
}
