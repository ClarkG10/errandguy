-- Migration 001: Create users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone VARCHAR(20) UNIQUE,
    email VARCHAR(255) UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    avatar_url TEXT,
    role VARCHAR(10) NOT NULL CHECK (role IN ('customer', 'runner')),
    status VARCHAR(15) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'banned', 'deleted')),
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
    default_lat DECIMAL(10, 7),
    default_lng DECIMAL(10, 7),
    fcm_token TEXT,
    wallet_balance DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    avg_rating DECIMAL(3, 2) NOT NULL DEFAULT 0.00,
    total_ratings INTEGER NOT NULL DEFAULT 0,
    last_active_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_phone ON users (phone);
CREATE INDEX idx_users_email ON users (email);
CREATE INDEX idx_users_role_status ON users (role, status);
