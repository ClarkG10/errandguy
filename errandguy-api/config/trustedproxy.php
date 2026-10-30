<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Trusted proxies
    |--------------------------------------------------------------------------
    |
    | The proxies in front of the app whose X-Forwarded-For / -Proto headers
    | are believed (App\Http\Middleware\TrustProxies). Comma-separated IPs or
    | CIDR ranges, or "cloudflare" for Cloudflare's published edge ranges
    | (App\Support\TrustedProxyList). Production behind Cloudflare:
    | TRUSTED_PROXIES=cloudflare, and firewall the origin to Cloudflare only.
    |
    | Empty trusts nobody: ip() is the connecting address, so behind Cloudflare
    | every client shares the edge's IP and per-IP rate limits become shared.
    | errandguy:check-prod-config flags that as critical.
    |
    */

    'proxies' => env('TRUSTED_PROXIES', ''),

];
