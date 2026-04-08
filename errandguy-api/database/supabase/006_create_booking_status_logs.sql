-- Migration 006: Create booking_status_logs table
CREATE TABLE booking_status_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    status VARCHAR(25) NOT NULL,
    changed_by UUID REFERENCES users(id),
    note TEXT,
    lat DECIMAL(10, 7),
    lng DECIMAL(10, 7),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_booking_status_logs_booking_id ON booking_status_logs (booking_id);
