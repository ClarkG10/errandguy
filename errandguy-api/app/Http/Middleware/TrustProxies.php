<?php

namespace App\Http\Middleware;

use App\Support\TrustedProxyList;
use Illuminate\Http\Middleware\TrustProxies as Middleware;
use Illuminate\Http\Request;

/**
 * Resolves the real client IP behind Cloudflare / a load balancer from the
 * TRUSTED_PROXIES list, read from config at REQUEST time.
 *
 * It used to be read with env() inside bootstrap/app.php's middleware closure,
 * which runs before .env is loaded (and never sees it once config is cached on
 * deploy), so the list never took effect.
 *
 * Unlike the framework default, an empty list trusts nobody on every host —
 * the framework auto-trusts ALL proxies on *.on-forge.com, which makes ip()
 * whatever the client puts first in X-Forwarded-For. Only X-Forwarded-For and
 * X-Forwarded-Proto are believed; a forwarded Host or Port could otherwise
 * poison the URLs the app builds.
 */
class TrustProxies extends Middleware
{
    protected $headers = Request::HEADER_X_FORWARDED_FOR | Request::HEADER_X_FORWARDED_PROTO;

    protected function setTrustedProxyIpAddresses(Request $request)
    {
        $proxies = TrustedProxyList::configured();

        if ($proxies !== []) {
            $request->setTrustedProxies($proxies, $this->getTrustedHeaderNames());
        }
    }
}
