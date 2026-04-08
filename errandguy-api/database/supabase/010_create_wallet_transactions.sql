-- Migration 010: Create wallet_transactions table
CREATE TABLE wallet_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    type VARCHAR(15) NOT NULL CHECK (type IN ('top_up', 'payment', 'refund', 'payout', 'bonus')),
    amount DECIMAL(10, 2) NOT NULL,
    balance_after DECIMAL(12, 2) NOT NULL,
    reference_id UUID,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_wallet_transactions_user_id_created ON wallet_transactions (user_id, created_at);
