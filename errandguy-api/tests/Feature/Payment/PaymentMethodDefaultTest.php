<?php

namespace Tests\Feature\Payment;

use App\Models\PaymentMethod;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * The default-payment-method state must stay consistent: setting a stale/deleted
 * method as default must NOT wipe the current default (it 404s), and promoting a
 * new default after a delete must skip expired/failed methods. (long-tail sweep)
 */
class PaymentMethodDefaultTest extends TestCase
{
    use RefreshDatabase;

    private function method(User $u, bool $default, string $status = 'active'): PaymentMethod
    {
        return PaymentMethod::create([
            'user_id' => $u->id, 'type' => 'card', 'status' => $status,
            'label' => 'Card '.Str::random(3), 'gateway_ref' => 'pm_'.Str::random(6),
            'is_default' => $default,
        ]);
    }

    public function test_set_default_switches_correctly(): void
    {
        Sanctum::actingAs($user = User::factory()->create(['role' => 'customer', 'status' => 'active']));
        $a = $this->method($user, true);
        $b = $this->method($user, false);

        $this->putJson("/api/v1/payments/methods/{$b->id}/default")->assertOk();

        $this->assertFalse((bool) $a->fresh()->is_default);
        $this->assertTrue((bool) $b->fresh()->is_default);
    }

    public function test_set_default_on_a_missing_method_404s_and_preserves_the_current_default(): void
    {
        Sanctum::actingAs($user = User::factory()->create(['role' => 'customer', 'status' => 'active']));
        $a = $this->method($user, true);

        $this->putJson('/api/v1/payments/methods/'.Str::uuid().'/default')->assertNotFound();

        // The existing default must NOT have been wiped.
        $this->assertTrue((bool) $a->fresh()->is_default);
    }

    public function test_deleting_the_default_promotes_an_active_method_not_an_expired_one(): void
    {
        Sanctum::actingAs($user = User::factory()->create(['role' => 'customer', 'status' => 'active']));
        $default = $this->method($user, true, 'active');
        $expired = $this->method($user, false, 'expired');
        $active = $this->method($user, false, 'active');

        $this->deleteJson("/api/v1/payments/methods/{$default->id}")->assertOk();

        $this->assertFalse((bool) $expired->fresh()->is_default, 'expired method must not become default');
        $this->assertTrue((bool) $active->fresh()->is_default, 'a usable method must be promoted');
    }
}
