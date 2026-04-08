-- Migration 020: Create system_config table
CREATE TABLE system_config (
    key VARCHAR(50) PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_by UUID,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed default config values
INSERT INTO system_config (key, value, description) VALUES
    ('platform_fee_percent', '15', 'Platform fee percentage taken from each booking'),
    ('max_negotiate_timeout_minutes', '30', 'Maximum time in minutes for negotiate pricing to expire'),
    ('runner_payout_percent', '85', 'Percentage of booking amount paid to runner'),
    ('auto_cancel_timeout_minutes', '5', 'Minutes before unaccepted booking is auto-cancelled'),
    ('sos_link_expiry_minutes', '60', 'Minutes before SOS live tracking link expires'),
    ('route_deviation_threshold_meters', '500', 'Meters of deviation before route deviation alert'),
    ('ride_duration_alert_multiplier', '2.0', 'Multiplier of estimated duration before ride duration alert'),
    ('location_update_interval_seconds', '5', 'Seconds between runner location updates'),
    ('max_saved_addresses', '10', 'Maximum number of saved addresses per user'),
    ('max_trusted_contacts', '5', 'Maximum number of trusted contacts per user');
