<?php

namespace Tests\Feature\Support;

use App\Exceptions\BookingStateException;
use App\Exceptions\InvalidStatusTransitionException;
use App\Exceptions\PaymentGatewayException;
use App\Exceptions\PayoutStateException;
use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

/**
 * Exercises the App\Exceptions\ApiExceptionRenderer map. Uses self-contained
 * throwing routes so each branch is tested in isolation, independent of any
 * business endpoint's current shape.
 */
class ExceptionRenderingTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        Route::middleware('api')->prefix('api/v1/_test')->group(function () {
            Route::get('gateway', fn () => throw new PaymentGatewayException(
                'internal', 'Xendit says: channel not activated', 'CHANNEL_INACTIVE',
            ));
            Route::get('booking-state', fn () => throw new BookingStateException('This booking is already completed.'));
            Route::get('payout-state', fn () => throw new PayoutStateException('Only a pending payout can be sent.'));
            Route::get('invalid-transition', fn () => throw InvalidStatusTransitionException::for('payment', 'pending', 'refunded'));
            Route::get('authz', fn () => throw new AuthorizationException('nope'));
            Route::get('model-missing', fn () => User::query()->findOrFail('does-not-exist'));
            Route::get('boom', fn () => throw new \RuntimeException('SECRET internal stack detail'));
        });

        // A NON-api route (mimics a Filament/Livewire request path) that throws,
        // to prove the renderer does NOT hijack it even when Accept: application/json.
        Route::get('_webtest/boom', fn () => throw new \RuntimeException('web boom'));
    }

    public function test_non_api_json_request_is_not_hijacked_by_the_api_renderer(): void
    {
        // Filament runs on Livewire, whose update requests satisfy expectsJson().
        // The renderer must ignore anything outside /api/* so Filament handles its
        // own exceptions — otherwise every admin tab/filter shows "Error while
        // loading page". Assert our envelope is NOT applied here (no success/code
        // keys; Laravel's default JSON error shape has neither).
        $res = $this->getJson('/_webtest/boom');
        $this->assertNull($res->json('code'));
        $this->assertNull($res->json('success'));
    }

    public function test_gateway_failure_renders_as_422_never_5xx(): void
    {
        $res = $this->getJson('/api/v1/_test/gateway');

        $res->assertStatus(422)
            ->assertJsonPath('success', false)
            ->assertJsonPath('code', 'PAYMENT_GATEWAY_ERROR')
            ->assertJsonPath('data', null);

        // Friendly, honest copy — and never the raw gateway/internal text.
        $this->assertStringContainsString('weren’t charged', $res->json('message'));
        $this->assertStringNotContainsString('channel not activated', (string) $res->json('message'));
    }

    public function test_gateway_reason_appears_only_in_debug_meta(): void
    {
        config(['app.debug' => true]);
        $res = $this->getJson('/api/v1/_test/gateway');
        $res->assertStatus(422);
        $this->assertStringContainsString('channel not activated', json_encode($res->json('meta')));
        // Still absent from the user-facing message.
        $this->assertStringNotContainsString('channel not activated', (string) $res->json('message'));
    }

    public function test_booking_and_payout_state_map_to_specific_422_codes(): void
    {
        $this->getJson('/api/v1/_test/booking-state')
            ->assertStatus(422)
            ->assertJsonPath('code', 'BOOKING_STATE_INVALID')
            ->assertJsonPath('message', 'This booking is already completed.');

        $this->getJson('/api/v1/_test/payout-state')
            ->assertStatus(422)
            ->assertJsonPath('code', 'PAYOUT_STATE_INVALID')
            ->assertJsonPath('message', 'Only a pending payout can be sent.');
    }

    public function test_authorization_failure_is_403(): void
    {
        $this->getJson('/api/v1/_test/authz')
            ->assertStatus(403)
            ->assertJsonPath('success', false)
            ->assertJsonPath('code', 'FORBIDDEN');
    }

    public function test_model_not_found_is_404_and_leaks_no_model_class(): void
    {
        $res = $this->getJson('/api/v1/_test/model-missing');
        $res->assertStatus(404)
            ->assertJsonPath('code', 'NOT_FOUND');
        $this->assertStringNotContainsString('User', (string) $res->json('message'));
        $this->assertStringNotContainsString('\\', (string) $res->json('message'));
    }

    public function test_unhandled_throwable_is_500_and_leaks_nothing_even_in_debug(): void
    {
        config(['app.debug' => true]);
        $res = $this->getJson('/api/v1/_test/boom');

        $res->assertStatus(500)
            ->assertJsonPath('success', false)
            ->assertJsonPath('code', 'SERVER_ERROR');

        // The user-facing message is generic — no class name, no internal text.
        $this->assertStringNotContainsString('SECRET internal stack detail', (string) $res->json('message'));
        $this->assertStringNotContainsString('RuntimeException', (string) $res->json('message'));
        // Debug detail is confined to meta.debug (only because APP_DEBUG is on).
        $this->assertStringContainsString('SECRET internal stack detail', json_encode($res->json('meta')));
    }

    public function test_invalid_status_transition_is_500(): void
    {
        $this->getJson('/api/v1/_test/invalid-transition')
            ->assertStatus(500)
            ->assertJsonPath('code', 'INVALID_STATUS_TRANSITION');
    }

    public function test_unauthenticated_api_request_is_enveloped_401(): void
    {
        // A real protected endpoint, hit with no token.
        $this->getJson('/api/v1/wallet/balance')
            ->assertStatus(401)
            ->assertJsonPath('success', false)
            ->assertJsonPath('code', 'UNAUTHENTICATED');
    }
}
