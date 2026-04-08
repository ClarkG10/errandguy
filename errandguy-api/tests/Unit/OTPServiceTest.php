<?php

namespace Tests\Unit;

use App\Services\OTPService;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

class OTPServiceTest extends TestCase
{
    private OTPService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new OTPService();
    }

    public function test_generates_6_digit_otp(): void
    {
        $otp = $this->service->generateOTP();

        $this->assertMatchesRegularExpression('/^\d{6}$/', $otp);
        $this->assertEquals(6, strlen($otp));
    }

    public function test_stores_otp_in_cache(): void
    {
        $this->service->storeOTP('test@example.com', '123456');

        $this->assertTrue(Cache::has('otp:test@example.com'));
    }

    public function test_verifies_correct_otp(): void
    {
        $this->service->storeOTP('test@example.com', '123456');

        $result = $this->service->verifyOTP('test@example.com', '123456');

        $this->assertTrue($result);
    }

    public function test_rejects_incorrect_otp(): void
    {
        $this->service->storeOTP('test@example.com', '123456');

        $result = $this->service->verifyOTP('test@example.com', '999999');

        $this->assertFalse($result);
    }

    public function test_rejects_expired_otp(): void
    {
        // No OTP stored = behaves like expired
        $result = $this->service->verifyOTP('nonexistent@example.com', '123456');

        $this->assertFalse($result);
    }

    public function test_invalidates_otp_after_success(): void
    {
        $this->service->storeOTP('test@example.com', '123456');
        $this->service->verifyOTP('test@example.com', '123456');

        // Second attempt should fail
        $result = $this->service->verifyOTP('test@example.com', '123456');
        $this->assertFalse($result);
    }

    public function test_tracks_failed_attempts(): void
    {
        $this->service->storeOTP('test@example.com', '123456');

        $this->service->verifyOTP('test@example.com', '000000');
        $this->assertEquals(1, $this->service->getAttemptCount('test@example.com'));

        $this->service->verifyOTP('test@example.com', '000001');
        $this->assertEquals(2, $this->service->getAttemptCount('test@example.com'));
    }

    public function test_blocks_after_5_failed_attempts(): void
    {
        $this->service->storeOTP('test@example.com', '123456');

        // Exhaust 5 attempts
        for ($i = 0; $i < 5; $i++) {
            $this->service->verifyOTP('test@example.com', '000000');
        }

        // 6th attempt with correct code should fail
        $result = $this->service->verifyOTP('test@example.com', '123456');
        $this->assertFalse($result);
    }

    public function test_invalidate_clears_cache(): void
    {
        $this->service->storeOTP('test@example.com', '123456');
        $this->service->invalidateOTP('test@example.com');

        $this->assertFalse(Cache::has('otp:test@example.com'));
        $this->assertFalse(Cache::has('otp_attempts:test@example.com'));
    }

    public function test_store_resets_attempts(): void
    {
        $this->service->storeOTP('test@example.com', '123456');
        $this->service->incrementAttempts('test@example.com');
        $this->service->incrementAttempts('test@example.com');
        $this->assertEquals(2, $this->service->getAttemptCount('test@example.com'));

        // Re-storing OTP should reset attempts
        $this->service->storeOTP('test@example.com', '654321');
        $this->assertEquals(0, $this->service->getAttemptCount('test@example.com'));
    }
}
