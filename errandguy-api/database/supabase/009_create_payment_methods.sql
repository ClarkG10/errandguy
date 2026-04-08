-- Migration 009: Create payment_methods table
CREATE TABLE payment_methods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(15) NOT NULL,
    label VARCHAR(50) NOT NULL,
    gateway_token TEXT,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    last_four VARCHAR(4),
    card_brand VARCHAR(20),
    expires_at DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payment_methods_user_id ON payment_methods (user_id);
