-- Migration 002: Create runner_profiles table
CREATE TABLE runner_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    verification_status VARCHAR(15) NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'approved', 'rejected', 'resubmit')),
    vehicle_type VARCHAR(15) CHECK (vehicle_type IN ('walk', 'bicycle', 'motorcycle', 'car')),
    vehicle_plate VARCHAR(20),
    vehicle_photo_url TEXT,
    is_online BOOLEAN NOT NULL DEFAULT FALSE,
    current_lat DECIMAL(10, 7),
    current_lng DECIMAL(10, 7),
    last_location_at TIMESTAMPTZ,
    acceptance_rate DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
    completion_rate DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
    total_errands INTEGER NOT NULL DEFAULT 0,
    total_earnings DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    preferred_types JSONB NOT NULL DEFAULT '[]',
    working_area_lat DECIMAL(10, 7),
    working_area_lng DECIMAL(10, 7),
    working_area_radius INTEGER NOT NULL DEFAULT 5000,
    bank_name VARCHAR(100),
    bank_account_number TEXT,
    ewallet_number VARCHAR(20),
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_runner_profiles_user_id ON runner_profiles (user_id);
CREATE INDEX idx_runner_profiles_online_location ON runner_profiles (current_lat, current_lng) WHERE is_online = TRUE;
