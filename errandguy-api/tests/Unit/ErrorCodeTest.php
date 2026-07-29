<?php

namespace Tests\Unit;

use App\Support\ErrorCode;
use App\Support\Messages;
use PHPUnit\Framework\TestCase;

class ErrorCodeTest extends TestCase
{
    public function test_every_code_has_a_nonempty_default_message(): void
    {
        foreach (ErrorCode::cases() as $code) {
            $message = $code->defaultMessage();
            $this->assertNotSame('', trim($message), "Missing copy for {$code->value}");
            // Every user-facing line should read as a full sentence.
            $this->assertStringEndsWith('.', $message, "Copy for {$code->value} should end with a period");
        }
    }

    public function test_default_message_is_sourced_from_the_catalog(): void
    {
        $this->assertSame(
            Messages::for(ErrorCode::INSUFFICIENT_WALLET_BALANCE),
            ErrorCode::INSUFFICIENT_WALLET_BALANCE->defaultMessage(),
        );
    }

    public function test_http_status_mapping(): void
    {
        $this->assertSame(401, ErrorCode::UNAUTHENTICATED->httpStatus());
        $this->assertSame(403, ErrorCode::FORBIDDEN->httpStatus());
        $this->assertSame(404, ErrorCode::BOOKING_NOT_FOUND->httpStatus());
        $this->assertSame(409, ErrorCode::BOOKING_CONFLICT->httpStatus());
        $this->assertSame(429, ErrorCode::RATE_LIMITED->httpStatus());
        $this->assertSame(500, ErrorCode::INVALID_STATUS_TRANSITION->httpStatus());
        // The whole point of the taxonomy: gateway rejections stay off the
        // app-level 5xx path (Cloudflare masks 502s, app discards >=500 copy).
        $this->assertSame(422, ErrorCode::PAYMENT_GATEWAY_ERROR->httpStatus());
        $this->assertSame(422, ErrorCode::INSUFFICIENT_WALLET_BALANCE->httpStatus());
    }
}
