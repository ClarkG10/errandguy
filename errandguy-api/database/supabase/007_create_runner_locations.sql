-- Migration 007: Create runner_locations table
-- NOTE: Enable Supabase Realtime on this table
CREATE TABLE runner_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID REFERENCES bookings(id),
    runner_id UUID NOT NULL REFERENCES users(id),
    lat DECIMAL(10, 7) NOT NULL,
    lng DECIMAL(10, 7) NOT NULL,
    heading DECIMAL(5, 2),
    speed DECIMAL(5, 2),
    accuracy DECIMAL(5, 2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_runner_locations_booking_id ON runner_locations (booking_id);
CREATE INDEX idx_runner_locations_runner_id_created ON runner_locations (runner_id, created_at);
