<?php

namespace Tests\Feature\Observability;

use App\Observability\SentryScrubber;
use Sentry\Breadcrumb;
use Sentry\Event;
use Sentry\State\HubInterface;
use Tests\TestCase;

/**
 * Guards the safety-critical invariants of the Sentry wiring. These are the
 * settings that, if silently regressed, would turn error monitoring into a
 * PII leak for a payments app — so they are asserted, not assumed.
 */
class SentryConfigTest extends TestCase
{
    public function test_pii_reporting_is_off_by_default(): void
    {
        // Sentry must not attach cookies or client IPs. Default (no env) MUST
        // be false.
        $this->assertFalse((bool) config('sentry.send_default_pii'));
    }

    public function test_request_body_capture_is_disabled(): void
    {
        // The request body is captured INDEPENDENTLY of send_default_pii (the
        // default 'medium' ships up to 10KB of body). For a payments app the
        // body is the PII, so it MUST be 'none'. This is the invariant that,
        // if regressed, silently leaks phone/OTP/card on the first DSN paste.
        $this->assertSame('none', config('sentry.max_request_body_size'));
    }

    public function test_sql_query_bindings_are_never_captured(): void
    {
        // Bindings are where phones/OTPs/amounts live. Both the breadcrumb and
        // the tracing span capture of bindings must stay off.
        $this->assertFalse((bool) config('sentry.breadcrumbs.sql_bindings'));
        $this->assertFalse((bool) config('sentry.tracing.sql_bindings'));
    }

    public function test_performance_tracing_is_off_by_default(): void
    {
        // No APM overhead until someone opts in via SENTRY_TRACES_SAMPLE_RATE.
        $this->assertNull(config('sentry.traces_sample_rate'));
        $this->assertNull(config('sentry.profiles_sample_rate'));
    }

    public function test_before_send_is_a_serializable_class_callable(): void
    {
        // Must be a [class, method] array — NOT a Closure — or `config:cache`
        // (run on every prod deploy) would fatally fail to serialize this file.
        $beforeSend = config('sentry.before_send');

        $this->assertIsArray($beforeSend);
        $this->assertSame([SentryScrubber::class, 'handle'], $beforeSend);
        $this->assertIsCallable($beforeSend);
    }

    public function test_dsn_defaults_to_null_so_the_sdk_is_inert(): void
    {
        // With no DSN the SDK builds no transport and captures nothing —
        // safe to ship before the account exists.
        $this->assertNull(config('sentry.dsn'));
    }

    public function test_hub_still_resolves_when_inert(): void
    {
        // The provider must boot cleanly with no DSN (this is what makes the
        // inert deploy safe).
        $this->assertInstanceOf(HubInterface::class, app(HubInterface::class));
    }

    public function test_health_endpoints_are_ignored_as_transactions(): void
    {
        $ignored = config('sentry.ignore_transactions');

        $this->assertContains('/up', $ignored);
        $this->assertContains('/health', $ignored);
    }

    public function test_scrubber_redacts_sensitive_request_and_extra_keys(): void
    {
        $event = Event::createEvent();
        $event->setRequest([
            'url' => 'https://api.example.test/login',
            'method' => 'POST',
            'data' => [
                'phone_or_email' => 'user@example.test',
                'password' => 'hunter2',
                'otp' => '123456',
                'nested' => [
                    'card_number' => '4111111111111111',
                    'amount' => 500,
                ],
            ],
            'headers' => [
                'Authorization' => 'Bearer eg_secrettoken',
                'Accept' => 'application/json',
                'Cookie' => 'session=abc',
            ],
        ]);
        $event->setExtra([
            'access_token' => 'eg_abc123',
            'booking_id' => 42,
        ]);

        $result = SentryScrubber::handle($event);

        $this->assertInstanceOf(Event::class, $result);

        $request = $result->getRequest();

        // Redacted — including the identity fields (phone_or_email) that reach
        // context/breadcrumbs and are NOT covered by the body/PII flags.
        $this->assertSame('[Filtered]', $request['data']['phone_or_email']);
        $this->assertSame('[Filtered]', $request['data']['password']);
        $this->assertSame('[Filtered]', $request['data']['otp']);
        $this->assertSame('[Filtered]', $request['data']['nested']['card_number']);
        $this->assertSame('[Filtered]', $request['headers']['Authorization']);
        $this->assertSame('[Filtered]', $request['headers']['Cookie']);
        $this->assertSame('[Filtered]', $result->getExtra()['access_token']);

        // Preserved — over-redaction would gut the debugging value.
        $this->assertSame(500, $request['data']['nested']['amount']);
        $this->assertSame('application/json', $request['headers']['Accept']);
        $this->assertSame(42, $result->getExtra()['booking_id']);
    }

    public function test_scrubber_redacts_query_string_by_param(): void
    {
        $event = Event::createEvent();
        $event->setRequest([
            'url' => 'https://api.example.test/x',
            'method' => 'GET',
            'query_string' => 'phone=%2B639171234567&otp=123456&page=2',
        ]);

        $qs = SentryScrubber::handle($event)->getRequest()['query_string'];
        parse_str($qs, $parsed);

        $this->assertSame('[Filtered]', $parsed['phone']);
        $this->assertSame('[Filtered]', $parsed['otp']);
        $this->assertSame('2', $parsed['page']);
    }

    public function test_scrubber_matches_short_tokens_only_as_whole_keys(): void
    {
        // "pin" must redact a real PIN field but NOT "shipping_status" /
        // "mapping" (which merely contain the letters p-i-n), and "ip" must not
        // match "shipping" as a substring.
        $event = Event::createEvent();
        $event->setExtra([
            'pin' => '4321',
            'shipping_status' => 'delivered',
            'mapping' => 'a->b',
        ]);

        $extra = SentryScrubber::handle($event)->getExtra();

        $this->assertSame('[Filtered]', $extra['pin']);
        $this->assertSame('delivered', $extra['shipping_status']);
        $this->assertSame('a->b', $extra['mapping']);
    }

    public function test_scrubber_redacts_breadcrumb_metadata(): void
    {
        // Breadcrumbs bypass send_default_pii, so a sensitive key in breadcrumb
        // metadata must still be redacted.
        // Mirrors the real OTP-flow log line: ['identifier' => phone/email,
        // 'ip' => client ip] — both must be redacted in the breadcrumb.
        $event = Event::createEvent();
        $event->setBreadcrumb([
            new Breadcrumb(
                Breadcrumb::LEVEL_INFO,
                Breadcrumb::TYPE_DEFAULT,
                'log.info',
                'OTP requested',
                [
                    'identifier' => '+639171234567',
                    'ip' => '203.0.113.7',
                    'password' => 'hunter2',
                    'attempt' => 1,
                ]
            ),
        ]);

        $metadata = SentryScrubber::handle($event)->getBreadcrumbs()[0]->getMetadata();

        $this->assertSame('[Filtered]', $metadata['identifier']);
        $this->assertSame('[Filtered]', $metadata['ip']);
        $this->assertSame('[Filtered]', $metadata['password']);
        $this->assertSame(1, $metadata['attempt']);
    }

    public function test_scrubber_never_throws_on_malformed_breadcrumb_metadata(): void
    {
        // A breadcrumb with an integer metadata key holding an array must not
        // throw (withMetadata is typed string $name under strict_types). The
        // SDK does not guard before_send, so a throw would drop the report.
        $event = Event::createEvent();
        $event->setBreadcrumb([
            new Breadcrumb(
                Breadcrumb::LEVEL_INFO,
                Breadcrumb::TYPE_DEFAULT,
                'log',
                null,
                [0 => ['nested' => 'x'], 'token' => 'abc']
            ),
        ]);

        $result = SentryScrubber::handle($event);

        $this->assertInstanceOf(Event::class, $result);
        $this->assertSame('[Filtered]', $result->getBreadcrumbs()[0]->getMetadata()['token']);
    }
}
