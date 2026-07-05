<?php

namespace App\Services;

use App\Models\SystemConfig;

/**
 * The catalog of settlement methods the platform can offer, and which of
 * them are currently ENABLED (operator-controlled).
 *
 * "Available payment methods" are managed here: the enabled set is stored in
 * system_config under `enabled_payment_methods` (a CSV of type keys) so an
 * admin can turn GCash / Maya / Card / Wallet / Cash on or off without a
 * deploy. The customer app reads `enabled()` to decide what to show, and
 * booking/top-up validation rejects a disabled method.
 */
class PaymentMethodCatalog
{
    public const CONFIG_KEY = 'enabled_payment_methods';

    /** Every method the platform knows how to process, in display order. */
    public const CATALOG = [
        ['type' => 'wallet', 'label' => 'ErrandGuy Wallet', 'description' => 'Pay instantly from your wallet balance', 'online' => false],
        ['type' => 'gcash',  'label' => 'GCash',            'description' => 'Pay online via GCash',                  'online' => true],
        ['type' => 'maya',   'label' => 'Maya',             'description' => 'Pay online via Maya',                   'online' => true],
        ['type' => 'card',   'label' => 'Credit / Debit Card', 'description' => 'Pay online with your card',          'online' => true],
        ['type' => 'cash',   'label' => 'Cash on Delivery', 'description' => 'Pay your runner directly on completion', 'online' => false],
    ];

    /** All valid method type keys. */
    public static function allTypes(): array
    {
        return array_column(self::CATALOG, 'type');
    }

    /** The enabled type keys (defaults to all if unset/blank). */
    public static function enabledTypes(): array
    {
        $raw = SystemConfig::getValue(self::CONFIG_KEY, implode(',', self::allTypes()));
        $types = array_values(array_filter(array_map('trim', explode(',', (string) $raw))));
        $valid = self::allTypes();
        $types = array_values(array_intersect($types, $valid));

        // Never leave the platform with zero payable methods.
        return empty($types) ? $valid : $types;
    }

    public static function isEnabled(string $type): bool
    {
        return in_array($type, self::enabledTypes(), true);
    }

    /** Enabled catalog entries (what the customer app should display). */
    public static function enabled(): array
    {
        $enabled = self::enabledTypes();

        return array_values(array_filter(
            self::CATALOG,
            fn ($m) => in_array($m['type'], $enabled, true),
        ));
    }

    /** Full catalog annotated with an `enabled` flag (for the admin UI). */
    public static function catalogWithState(): array
    {
        $enabled = self::enabledTypes();

        return array_map(
            fn ($m) => [...$m, 'enabled' => in_array($m['type'], $enabled, true)],
            self::CATALOG,
        );
    }

    /**
     * Persist a new enabled set. Silently ignores unknown keys and refuses
     * an empty set (there must always be at least one way to pay).
     */
    public static function setEnabled(array $types, ?string $updatedBy = null): array
    {
        $valid = array_values(array_intersect(
            array_map('trim', $types),
            self::allTypes(),
        ));
        if (empty($valid)) {
            $valid = self::allTypes();
        }

        SystemConfig::setValue(self::CONFIG_KEY, implode(',', $valid), $updatedBy);

        // Bust derived caches so the app sees the change immediately.
        CacheService::forget('app_config');
        CacheService::forget('payments:available_methods');

        return $valid;
    }
}
