<?php

namespace Database\Seeders;

use App\Models\ErrandType;
use Illuminate\Database\Seeder;

/**
 * The launch catalog: four errand types.
 *
 * Runs on EVERY deploy (deploy.sh), so it only ever CREATES a type whose slug
 * is missing and never touches one that exists. Names, descriptions, prices,
 * sort order and the on/off switch all belong to staff once a type is in the
 * database (Filament → Errand types); the values below are only the starting
 * point for a fresh install. It used to updateOrCreate, which quietly reset
 * every staff price edit back to these defaults on each deploy.
 *
 * Retired types (document, laundry, food, grocery, bills_payment,
 * transportation) are deliberately absent: their rows stay in the database,
 * switched off, so older bookings still show their type — see
 * 2026_10_30_000001_simplify_errand_catalog.
 */
class ErrandTypeSeeder extends Seeder
{
    public function run(): void
    {
        $types = [
            [
                'slug' => 'delivery',
                'name' => 'Delivery',
                'description' => 'Parcels, documents or laundry — picked up and dropped off',
                'icon_name' => 'Package',
                'base_fee' => 50.00,
                'per_km_walk' => 15.00,
                'per_km_bicycle' => 12.00,
                'per_km_motorcycle' => 10.00,
                'per_km_car' => 18.00,
                'min_negotiate_fee' => 30.00,
                'is_active' => true,
                'sort_order' => 1,
            ],
            [
                'slug' => 'purchase',
                'name' => 'Buy for me',
                'description' => 'Groceries, food or anything you need — bought and brought to you',
                'icon_name' => 'ShoppingBag',
                'base_fee' => 70.00,
                'per_km_walk' => 15.00,
                'per_km_bicycle' => 12.00,
                'per_km_motorcycle' => 10.00,
                'per_km_car' => 18.00,
                'min_negotiate_fee' => 50.00,
                'is_active' => true,
                'sort_order' => 2,
            ],
            [
                'slug' => 'queue',
                'name' => 'Queue / Pila',
                'description' => 'Have someone wait in line for you',
                'icon_name' => 'Users',
                'base_fee' => 100.00,
                'per_km_walk' => 15.00,
                'per_km_bicycle' => 12.00,
                'per_km_motorcycle' => 10.00,
                'per_km_car' => 18.00,
                'min_negotiate_fee' => 80.00,
                'is_active' => true,
                'sort_order' => 3,
            ],
            [
                'slug' => 'custom',
                'name' => 'Custom errand',
                'description' => 'Any other errand you need done',
                'icon_name' => 'Clipboard',
                'base_fee' => 60.00,
                'per_km_walk' => 15.00,
                'per_km_bicycle' => 12.00,
                'per_km_motorcycle' => 10.00,
                'per_km_car' => 18.00,
                'min_negotiate_fee' => 40.00,
                'is_active' => true,
                'sort_order' => 4,
            ],
        ];

        foreach ($types as $type) {
            ErrandType::firstOrCreate(['slug' => $type['slug']], $type);
        }
    }
}
