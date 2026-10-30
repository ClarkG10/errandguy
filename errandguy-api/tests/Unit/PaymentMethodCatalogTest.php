<?php

namespace Tests\Unit;

use App\Services\PaymentMethodCatalog;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PaymentMethodCatalogTest extends TestCase
{
    use RefreshDatabase;

    public function test_defaults_to_the_four_launch_methods(): void
    {
        $this->assertEqualsCanonicalizing(
            ['wallet', 'gcash', 'maya', 'cash'],
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

    public function test_invalid_and_retired_keys_are_ignored(): void
    {
        PaymentMethodCatalog::setEnabled(['bogus', 'card', 'grabpay', 'maya']);
        $this->assertEqualsCanonicalizing(['maya'], PaymentMethodCatalog::enabledTypes());
    }

    public function test_a_stored_setting_that_still_lists_card_never_offers_it(): void
    {
        // A server whose setting predates the retirement still says card.
        \App\Models\SystemConfig::setValue(PaymentMethodCatalog::CONFIG_KEY, 'wallet,gcash,maya,card,cash');

        $this->assertEqualsCanonicalizing(['wallet', 'gcash', 'maya', 'cash'], PaymentMethodCatalog::enabledTypes());
        $this->assertNotContains('card', array_column(PaymentMethodCatalog::enabled(), 'type'));
    }

    public function test_empty_set_falls_back_to_all(): void
    {
        PaymentMethodCatalog::setEnabled([]);
        $this->assertEqualsCanonicalizing(
            ['wallet', 'gcash', 'maya', 'cash'],
            PaymentMethodCatalog::enabledTypes(),
        );
    }

    public function test_retired_methods_get_a_clear_refusal(): void
    {
        $this->assertSame(
            'Card payments are no longer available — please pay with GCash, Maya or cash.',
            PaymentMethodCatalog::retiredMessage('card'),
        );
        $this->assertSame(
            'GrabPay is no longer available — please pay with GCash, Maya or cash.',
            PaymentMethodCatalog::retiredMessage('grabpay'),
        );
        $this->assertSame(
            'GrabPay is no longer available — please pay with GCash, Maya or your ErrandGuy wallet.',
            PaymentMethodCatalog::retiredMessage('grab_pay', 'GCash, Maya or your ErrandGuy wallet'),
        );
        $this->assertNull(PaymentMethodCatalog::retiredMessage('gcash'));
        $this->assertNull(PaymentMethodCatalog::retiredMessage(null));
    }

    public function test_catalog_with_state_flags_enabled(): void
    {
        PaymentMethodCatalog::setEnabled(['wallet']);
        $state = collect(PaymentMethodCatalog::catalogWithState())->keyBy('type');
        $this->assertTrue($state['wallet']['enabled']);
        $this->assertFalse($state['gcash']['enabled']);
    }
}
