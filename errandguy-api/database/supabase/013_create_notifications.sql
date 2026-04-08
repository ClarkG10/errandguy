-- Migration 013: Create notifications table
-- NOTE: Enable Supabase Realtime on this table
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(100) NOT NULL,
    body TEXT NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('booking_update', 'payment', 'promo', 'system', 'sos', 'chat')),
    data JSONB,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user_id_created ON notifications (user_id, created_at);
