-- Migration 019: Create dispute_tickets table
CREATE TABLE dispute_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL REFERENCES bookings(id),
    reported_by UUID NOT NULL REFERENCES users(id),
    category VARCHAR(30) NOT NULL,
    description TEXT NOT NULL,
    evidence_urls JSONB NOT NULL DEFAULT '[]',
    status VARCHAR(15) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'resolved', 'escalated')),
    resolution TEXT,
    resolved_by UUID,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_dispute_tickets_booking_id ON dispute_tickets (booking_id);
