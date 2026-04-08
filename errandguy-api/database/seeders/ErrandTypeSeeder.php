<?php

namespace Database\Seeders;

use App\Models\ErrandType;
use Illuminate\Database\Seeder;

class ErrandTypeSeeder extends Seeder
{
    public function run(): void
    {
        $types = [
            [
                'slug' => 'delivery',
                'name' => 'Delivery',
                'description' => 'Send or receive packages and items',
                'icon_name' => 'Package',
                'base_fee' => 50.00,
                'per_km_walk' => 15.00,
                'per_km_bicycle' => 12.00,
                'per_km_motorcycle' => 10.00,
                'per_km_car' => 18.00,
                'min_negotiate_fee' => 30.00,
                'sort_order' => 1,
            ],
            [
                'slug' => 'grocery',
                'name' => 'Grocery',
                'description' => 'Get groceries and essentials delivered',
                'icon_name' => 'ShoppingCart',
                'base_fee' => 60.00,
                'per_km_walk' => 15.00,
                'per_km_bicycle' => 12.00,
                'per_km_motorcycle' => 10.00,
                'per_km_car' => 18.00,
                'min_negotiate_fee' => 40.00,
                'sort_order' => 2,
            ],
            [
                'slug' => 'food',
                'name' => 'Food Pickup',
                'description' => 'Order food from your favorite restaurants',
                'icon_name' => 'UtensilsCrossed',
                'base_fee' => 45.00,
                'per_km_walk' => 15.00,
                'per_km_bicycle' => 12.00,
                'per_km_motorcycle' => 10.00,
                'per_km_car' => 18.00,
                'min_negotiate_fee' => 30.00,
                'sort_order' => 3,
            ],
            [
                'slug' => 'document',
                'name' => 'Document',
                'description' => 'Send or collect important documents',
                'icon_name' => 'FileText',
                'base_fee' => 55.00,
                'per_km_walk' => 15.00,
                'per_km_bicycle' => 12.00,
                'per_km_motorcycle' => 10.00,
                'per_km_car' => 18.00,
                'min_negotiate_fee' => 35.00,
                'sort_order' => 4,
            ],
            [
                'slug' => 'laundry',
                'name' => 'Laundry',
                'description' => 'Laundry pickup and delivery service',
                'icon_name' => 'Shirt',
                'base_fee' => 50.00,
                'per_km_walk' => 15.00,
                'per_km_bicycle' => 12.00,
                'per_km_motorcycle' => 10.00,
                'per_km_car' => 18.00,
                'min_negotiate_fee' => 35.00,
                'sort_order' => 5,
            ],
            [
                'slug' => 'transportation',
                'name' => 'Transportation',
                'description' => 'Get a ride to your destination',
                'icon_name' => 'Car',
                'base_fee' => 70.00,
                'per_km_walk' => 0.00,
                'per_km_bicycle' => 0.00,
                'per_km_motorcycle' => 12.00,
                'per_km_car' => 20.00,
                'min_negotiate_fee' => 50.00,
                'sort_order' => 6,
            ],
            [
                'slug' => 'custom',
                'name' => 'Custom Errand',
                'description' => 'Any other errand you need done',
                'icon_name' => 'Clipboard',
                'base_fee' => 60.00,
                'per_km_walk' => 15.00,
                'per_km_bicycle' => 12.00,
                'per_km_motorcycle' => 10.00,
                'per_km_car' => 18.00,
                'min_negotiate_fee' => 40.00,
                'sort_order' => 7,
            ],
        ];

        foreach ($types as $type) {
            ErrandType::updateOrCreate(
                ['slug' => $type['slug']],
                $type
            );
        }
    }
}
