<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Log;
use Tests\TestCase;

/**
 * The mobile crash-ingest endpoint turns release-build crashes (where console.*
 * goes nowhere) into a structured, rate-bounded server-side log signal. It
 * must: accept reports from signed-out screens too, log fatal at error /
 * non-fatal at warning with the user (when signed in), app version and
 * platform, throttle per account / per IP, and bound the payload.
 */
class ClientErrorTest extends TestCase
{
    use RefreshDatabase;

    public function test_authenticated_client_can_report_a_fatal_crash_and_it_is_logged_at_error(): void
    {
        Log::spy();
        $user = User::factory()->create(['status' => 'active']);

        $this->actingAs($user)->postJson('/api/v1/client-errors', [
            'message' => 'TypeError: undefined is not an object',
            'stack' => "at Foo\nat Bar",
            'fatal' => true,
            'platform' => 'ios',
        ])->assertOk()->assertJsonPath('status', 'ok');

        Log::shouldHaveReceived('log')
            ->once()
            ->withArgs(function ($level, $message, $context) use ($user) {
                return $level === 'error'
                    && str_contains((string) $message, '[client-crash]')
                    && ($context['user_id'] ?? null) === $user->id
                    && ($context['fatal'] ?? null) === true;
            });
    }

    public function test_non_fatal_report_logs_at_warning(): void
    {
        Log::spy();
        $user = User::factory()->create(['status' => 'active']);

        $this->actingAs($user)->postJson('/api/v1/client-errors', [
            'message' => 'a non-fatal issue',
        ])->assertOk();

        Log::shouldHaveReceived('log')
            ->once()
            ->withArgs(fn ($level) => $level === 'warning');
    }

    public function test_a_signed_out_screen_can_report_a_crash_with_its_app_version_and_platform(): void
    {
        Log::spy();

        $this->postJson('/api/v1/client-errors', [
            'message' => 'TypeError on the sign-in screen',
            'fatal' => true,
            'platform' => 'android',
            'app_version' => '1.4.2',
            'screen' => 'login',
        ])->assertOk()->assertJsonPath('status', 'ok');

        Log::shouldHaveReceived('log')
            ->once()
            ->withArgs(fn ($level, $message, $context) => $level === 'error'
                && array_key_exists('user_id', $context) && $context['user_id'] === null
                && ($context['signed_in'] ?? null) === false
                && ($context['platform'] ?? null) === 'android'
                && ($context['app_version'] ?? null) === '1.4.2');
    }

    public function test_a_bearer_token_still_attributes_the_report_to_the_user(): void
    {
        Log::spy();
        $user = User::factory()->create(['status' => 'active']);
        $token = $user->createToken('phone')->plainTextToken;

        $this->withHeader('Authorization', 'Bearer '.$token)
            ->postJson('/api/v1/client-errors', ['message' => 'boom'])
            ->assertOk();

        Log::shouldHaveReceived('log')
            ->once()
            ->withArgs(fn ($level, $message, $context) => ($context['user_id'] ?? null) === $user->id);
    }

    public function test_the_app_version_header_is_used_when_the_body_has_none(): void
    {
        Log::spy();

        $this->withHeaders(['X-App-Version' => '1.5.0', 'X-Platform' => 'ios'])
            ->postJson('/api/v1/client-errors', ['message' => 'boom'])
            ->assertOk();

        Log::shouldHaveReceived('log')
            ->once()
            ->withArgs(fn ($level, $message, $context) => ($context['app_version'] ?? null) === '1.5.0'
                && ($context['platform'] ?? null) === 'ios');
    }

    public function test_signed_out_reports_are_rate_limited_per_ip(): void
    {
        for ($i = 0; $i < 10; $i++) {
            $this->postJson('/api/v1/client-errors', ['message' => "crash {$i}"])->assertOk();
        }

        $this->postJson('/api/v1/client-errors', ['message' => 'one too many'])->assertStatus(429);

        // Another IP has its own allowance.
        $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.50'])
            ->postJson('/api/v1/client-errors', ['message' => 'different phone'])
            ->assertOk();
    }

    public function test_an_oversized_report_is_refused(): void
    {
        $this->postJson('/api/v1/client-errors', [
            'message' => 'big',
            'stack' => str_repeat('x', 8000),
            'component_stack' => str_repeat('y', 8000),
            'name' => str_repeat('z', 200),
            'screen' => str_repeat('s', 120),
            'padding' => str_repeat('p', 10000),
        ])->assertStatus(413)->assertJsonPath('code', 'PAYLOAD_TOO_LARGE');
    }

    public function test_message_is_required_and_bounded(): void
    {
        $user = User::factory()->create(['status' => 'active']);

        $this->actingAs($user)->postJson('/api/v1/client-errors', [])->assertStatus(422);
        $this->actingAs($user)->postJson('/api/v1/client-errors', [
            'message' => str_repeat('x', 1001),
        ])->assertStatus(422);
    }

    public function test_a_report_cannot_write_extra_lines_into_the_log(): void
    {
        \Illuminate\Support\Facades\Log::spy();

        $this->postJson('/api/v1/client-errors', [
            'message' => "boom\n[2026-11-04 10:00:00] production.CRITICAL: forged line",
        ])->assertOk();

        \Illuminate\Support\Facades\Log::shouldHaveReceived('log')->withArgs(
            fn ($level, $message, $context) => ! str_contains($message, "\n")
                && str_contains($message, 'boom [2026-11-04')
                && str_contains($context['message'], "\n"),
        );
    }
}
