<?php

namespace Tests\Unit;

use App\Support\ApiPayload;
use Tests\TestCase;

class ApiPayloadTest extends TestCase
{
    public function test_success_envelope_has_all_keys_and_stable_shapes(): void
    {
        $payload = ApiPayload::success(['balance' => 500], 'Loaded.', 'OK', ['extra' => 1]);

        $this->assertTrue($payload['success']);
        $this->assertSame('Loaded.', $payload['message']);
        $this->assertSame('OK', $payload['code']);
        $this->assertSame(['balance' => 500], $payload['data']);
        // errors must serialize as {} not [] so the client reads a stable object.
        $this->assertEquals((object) [], $payload['errors']);
        $this->assertIsArray($payload['meta']);
        $this->assertArrayHasKey('request_id', $payload['meta']);
        $this->assertSame(1, $payload['meta']['extra']);
    }

    public function test_error_envelope_has_all_keys_and_object_errors(): void
    {
        $payload = ApiPayload::error('VALIDATION_FAILED', 'Bad input.', ['email' => ['Required.']]);

        $this->assertFalse($payload['success']);
        $this->assertSame('Bad input.', $payload['message']);
        $this->assertSame('VALIDATION_FAILED', $payload['code']);
        $this->assertNull($payload['data']);
        $this->assertEquals((object) ['email' => ['Required.']], $payload['errors']);
        $this->assertArrayHasKey('request_id', $payload['meta']);
    }
}
