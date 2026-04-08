-- Migration 008: Create payments table
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL REFERENCES bookings(id),
    customer_id UUID NOT NULL REFERENCES users(id),
    amount DECIMAL(10, 2) NOT NULL,
    currency VARCHAR(5) NOT NULL DEFAULT 'PHP',
    method VARCHAR(15) NOT NULL CHECK (method IN ('card', 'gcash', 'maya', 'wallet', 'cash')),
    status VARCHAR(15) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'refunded')),
    gateway_tx_id VARCHAR(100),
    gateway_response JSONB,
    paid_at TIMESTAMPTZ,
    refund_amount DECIMAL(10, 2),
    refunded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payments_booking_id ON payments (booking_id);
CREATE INDEX idx_payments_customer_id ON payments (customer_id);
