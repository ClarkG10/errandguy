<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Log;
use Tests\TestCase;

/**
 * The mobile crash-ingest endpoint turns release-build crashes (where console.*
 * goes nowhere) into a structured, authenticated, rate-bounded server-side log
 * signal. It must: require auth, log fatal at error / non-fatal at warning with
 * the acting user for correlation, and bound the payload.
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

    public function test_crash_report_requires_authentication(): void
    {
        $this->postJson('/api/v1/client-errors', ['message' => 'x'])->assertStatus(401);
    }

    public function test_message_is_required_and_bounded(): void
    {
        $user = User::factory()->create(['status' => 'active']);

        $this->actingAs($user)->postJson('/api/v1/client-errors', [])->assertStatus(422);
        $this->actingAs($user)->postJson('/api/v1/client-errors', [
            'message' => str_repeat('x', 1001),
        ])->assertStatus(422);
    }
}
