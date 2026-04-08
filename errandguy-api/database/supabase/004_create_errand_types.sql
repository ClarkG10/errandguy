-- Migration 004: Create errand_types table
CREATE TABLE errand_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(30) NOT NULL UNIQUE,
    name VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    icon_name VARCHAR(30) NOT NULL,
    base_fee DECIMAL(8, 2) NOT NULL,
    per_km_walk DECIMAL(6, 2) NOT NULL,
    per_km_bicycle DECIMAL(6, 2) NOT NULL,
    per_km_motorcycle DECIMAL(6, 2) NOT NULL,
    per_km_car DECIMAL(6, 2) NOT NULL,
    surcharge DECIMAL(6, 2) NOT NULL DEFAULT 0.00,
    min_negotiate_fee DECIMAL(8, 2) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed 7 default errand types
INSERT INTO errand_types (slug, name, description, icon_name, base_fee, per_km_walk, per_km_bicycle, per_km_motorcycle, per_km_car, min_negotiate_fee, sort_order) VALUES
    ('delivery', 'Delivery', 'Send or receive packages and items', 'Package', 50.00, 15.00, 12.00, 10.00, 18.00, 30.00, 1),
    ('grocery', 'Grocery', 'Get groceries and essentials delivered', 'ShoppingCart', 60.00, 15.00, 12.00, 10.00, 18.00, 40.00, 2),
    ('food', 'Food Pickup', 'Order food from your favorite restaurants', 'UtensilsCrossed', 45.00, 15.00, 12.00, 10.00, 18.00, 30.00, 3),
    ('document', 'Document', 'Send or collect important documents', 'FileText', 55.00, 15.00, 12.00, 10.00, 18.00, 35.00, 4),
    ('laundry', 'Laundry', 'Laundry pickup and delivery service', 'Shirt', 50.00, 15.00, 12.00, 10.00, 18.00, 35.00, 5),
    ('transportation', 'Transportation', 'Get a ride to your destination', 'Car', 70.00, 0.00, 0.00, 12.00, 20.00, 50.00, 6),
    ('custom', 'Custom Errand', 'Any other errand you need done', 'Clipboard', 60.00, 15.00, 12.00, 10.00, 18.00, 40.00, 7);
