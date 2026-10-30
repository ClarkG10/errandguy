<?php

namespace Tests\Feature\Middleware;

use App\Support\TrustedProxyList;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

/**
 * TRUSTED_PROXIES used to be read with env() inside bootstrap/app.php before
 * .env was loaded (and never once config was cached), so it never took effect.
 * It is now read from config at request time by App\Http\Middleware\TrustProxies:
 * X-Forwarded-For is believed only when the connection comes from a listed
 * proxy, and an empty list believes nobody — on every host, including the
 * *.on-forge.com ones the framework would otherwise trust wholesale.
 */
class TrustProxiesTest extends TestCase
{
    private const CLOUDFLARE_EDGE = '173.245.48.10';

    protected function setUp(): void
    {
        parent::setUp();

        Route::get('/_test/client-ip', fn (Request $request) => response()->json([
            'ip' => $request->ip(),
            'secure' => $request->isSecure(),
        ]));
    }

    private function ipSeen(string $remoteAddr, ?string $forwardedFor, string $host = 'localhost'): string
    {
        $headers = $forwardedFor === null ? [] : ['X-Forwarded-For' => $forwardedFor];

        return $this->withServerVariables(['REMOTE_ADDR' => $remoteAddr, 'HTTP_HOST' => $host])
            ->withHeaders($headers)
            ->getJson('/_test/client-ip')
            ->assertOk()
            ->json('ip');
    }

    public function test_a_listed_proxy_is_believed(): void
    {
        config(['trustedproxy.proxies' => '10.0.0.0/8']);

        $this->assertSame('203.0.113.7', $this->ipSeen('10.1.2.3', '203.0.113.7'));
    }

    public function test_the_cloudflare_keyword_trusts_cloudflare_edges(): void
    {
        config(['trustedproxy.proxies' => 'cloudflare']);

        $this->assertSame('203.0.113.7', $this->ipSeen(self::CLOUDFLARE_EDGE, '203.0.113.7'));
    }

    public function test_a_spoofed_left_most_entry_is_ignored(): void
    {
        config(['trustedproxy.proxies' => 'cloudflare']);

        // The client sent "1.2.3.4" itself; Cloudflare appended the real address.
        $this->assertSame('203.0.113.7', $this->ipSeen(self::CLOUDFLARE_EDGE, '1.2.3.4, 203.0.113.7'));
    }

    public function test_forwarded_headers_from_an_unlisted_address_are_ignored(): void
    {
        config(['trustedproxy.proxies' => 'cloudflare']);

        // Hitting the origin directly with a made-up header gains nothing.
        $this->assertSame('198.51.100.20', $this->ipSeen('198.51.100.20', '203.0.113.7'));
    }

    public function test_an_empty_list_ignores_forwarded_headers(): void
    {
        config(['trustedproxy.proxies' => '']);

        $this->assertSame(self::CLOUDFLARE_EDGE, $this->ipSeen(self::CLOUDFLARE_EDGE, '203.0.113.7'));
    }

    public function test_an_empty_list_is_not_overridden_on_forge_hosts(): void
    {
        config(['trustedproxy.proxies' => '']);

        // The framework default trusts every proxy on *.on-forge.com.
        $this->assertSame(
            self::CLOUDFLARE_EDGE,
            $this->ipSeen(self::CLOUDFLARE_EDGE, '1.2.3.4', 'errandguy-test.on-forge.com'),
        );
    }

    public function test_a_wildcard_is_refused(): void
    {
        config(['trustedproxy.proxies' => '*']);

        $this->assertSame([], TrustedProxyList::configured());
        $this->assertSame('198.51.100.20', $this->ipSeen('198.51.100.20', '1.2.3.4'));
    }

    public function test_forwarded_proto_from_a_trusted_proxy_marks_the_request_secure(): void
    {
        config(['trustedproxy.proxies' => 'cloudflare']);

        $secure = $this->withServerVariables(['REMOTE_ADDR' => self::CLOUDFLARE_EDGE])
            ->withHeaders(['X-Forwarded-For' => '203.0.113.7', 'X-Forwarded-Proto' => 'https'])
            ->getJson('/_test/client-ip')
            ->json('secure');

        $this->assertTrue($secure);
    }

    public function test_the_list_parses_ranges_and_the_keyword_together(): void
    {
        $parsed = TrustedProxyList::parse(' cloudflare , 10.0.0.0/8 ,, 10.0.0.0/8');

        $this->assertContains('173.245.48.0/20', $parsed);
        $this->assertContains('2400:cb00::/32', $parsed);
        $this->assertSame(1, count(array_keys($parsed, '10.0.0.0/8', true)));
    }
}
