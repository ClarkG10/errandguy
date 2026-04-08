-- Migration 016: Create sos_alerts table
CREATE TABLE sos_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL REFERENCES bookings(id),
    customer_id UUID NOT NULL REFERENCES users(id),
    runner_id UUID NOT NULL REFERENCES users(id),
    triggered_at TIMESTAMPTZ NOT NULL,
    customer_lat DECIMAL(10, 7),
    customer_lng DECIMAL(10, 7),
    runner_lat DECIMAL(10, 7),
    runner_lng DECIMAL(10, 7),
    contacts_notified JSONB NOT NULL DEFAULT '[]',
    live_link_token VARCHAR(64),
    live_link_expires_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    resolution_note TEXT,
    status VARCHAR(15) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved', 'escalated')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sos_alerts_booking_id ON sos_alerts (booking_id);
