<?php

namespace Tests\Feature\Support;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Verifies the correlation id assigned by App\Http\Middleware\AssignRequestId:
 * echoed in the response header AND threaded into the error envelope's
 * meta.request_id (so a user-visible error can be traced to its log lines).
 *
 * Hitting a protected endpoint without auth yields a 401 that IS enveloped by
 * the exception renderer (active in Phase 0), giving us meta.request_id to
 * assert against before any controller adopts the success trait.
 */
class RequestIdTest extends TestCase
{
    use RefreshDatabase;

    private const ENDPOINT = '/api/v1/wallet/balance';

    public function test_inbound_request_id_is_reused_and_echoed(): void
    {
        $id = 'trace-abc-12345678';

        $res = $this->withHeaders(['X-Request-Id' => $id])->getJson(self::ENDPOINT);

        $res->assertStatus(401)
            ->assertHeader('X-Request-Id', $id)
            ->assertJsonPath('meta.request_id', $id);
    }

    public function test_request_id_is_generated_when_absent(): void
    {
        $res = $this->getJson(self::ENDPOINT);

        $res->assertStatus(401);
        $generated = $res->headers->get('X-Request-Id');
        $this->assertNotEmpty($generated);
        $this->assertSame($generated, $res->json('meta.request_id'));
    }

    public function test_malformed_inbound_id_is_replaced_not_reflected(): void
    {
        $bad = 'no'; // too short; also blocks header injection of junk ids

        $res = $this->withHeaders(['X-Request-Id' => $bad])->getJson(self::ENDPOINT);

        $res->assertStatus(401);
        $this->assertNotSame($bad, $res->headers->get('X-Request-Id'));
        $this->assertNotSame($bad, $res->json('meta.request_id'));
        $this->assertNotEmpty($res->json('meta.request_id'));
    }
}
