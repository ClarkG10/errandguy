<?php

namespace Tests\Unit;

use App\Services\PaymentMethodCatalog;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PaymentMethodCatalogTest extends TestCase
{
    use RefreshDatabase;

    public function test_defaults_to_all_methods_enabled(): void
    {
        $this->assertEqualsCanonicalizing(
            ['wallet', 'gcash', 'maya', 'card', 'cash'],
            PaymentMethodCatalog::enabledTypes(),
        );
    }

    public function test_operator_can_disable_methods(): void
    {
        PaymentMethodCatalog::setEnabled(['wallet', 'cash']);

        $this->assertEqualsCanonicalizing(['wallet', 'cash'], PaymentMethodCatalog::enabledTypes());
        $this->assertTrue(PaymentMethodCatalog::isEnabled('wallet'));
        $this->assertFalse(PaymentMethodCatalog::isEnabled('gcash'));
        $this->assertCount(2, PaymentMethodCatalog::enabled());
    }

    public function test_invalid_keys_are_ignored(): void
    {
        PaymentMethodCatalog::setEnabled(['bogus', 'card', 'nope']);
        $this->assertEqualsCanonicalizing(['card'], PaymentMethodCatalog::enabledTypes());
    }

    public function test_empty_set_falls_back_to_all(): void
    {
        PaymentMethodCatalog::setEnabled([]);
        $this->assertEqualsCanonicalizing(
            ['wallet', 'gcash', 'maya', 'card', 'cash'],
            PaymentMethodCatalog::enabledTypes(),
        );
    }

    public function test_catalog_with_state_flags_enabled(): void
    {
        PaymentMethodCatalog::setEnabled(['wallet']);
        $state = collect(PaymentMethodCatalog::catalogWithState())->keyBy('type');
        $this->assertTrue($state['wallet']['enabled']);
        $this->assertFalse($state['gcash']['enabled']);
    }
}
