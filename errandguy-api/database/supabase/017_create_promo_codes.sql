-- Migration 017: Create promo_codes table
CREATE TABLE promo_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(30) NOT NULL UNIQUE,
    description TEXT,
    discount_type VARCHAR(10) NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
    discount_value DECIMAL(8, 2) NOT NULL,
    max_discount DECIMAL(8, 2),
    min_order DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
    usage_limit INTEGER,
    per_user_limit INTEGER NOT NULL DEFAULT 1,
    used_count INTEGER NOT NULL DEFAULT 0,
    valid_from TIMESTAMPTZ NOT NULL,
    valid_until TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_promo_codes_code ON promo_codes (code);
