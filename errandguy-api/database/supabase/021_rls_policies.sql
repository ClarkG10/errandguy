-- RLS Policies for all tables
-- Run this after all tables are created in Supabase SQL Editor

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE runner_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE runner_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE errand_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_status_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE runner_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE trusted_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sos_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispute_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;

-- ============================================
-- USERS table policies
-- ============================================
CREATE POLICY "users_select_own" ON users
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "users_update_own" ON users
    FOR UPDATE USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- ============================================
-- RUNNER_PROFILES table policies
-- ============================================
CREATE POLICY "runner_profiles_select_own" ON runner_profiles
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "runner_profiles_update_own" ON runner_profiles
    FOR UPDATE USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "runner_profiles_select_for_booking" ON runner_profiles
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM bookings
            WHERE bookings.runner_id = runner_profiles.user_id
              AND bookings.customer_id = auth.uid()
              AND bookings.status NOT IN ('completed', 'cancelled')
        )
    );

-- ============================================
-- RUNNER_DOCUMENTS table policies
-- ============================================
CREATE POLICY "runner_documents_select_own" ON runner_documents
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM runner_profiles
            WHERE runner_profiles.id = runner_documents.runner_id
              AND runner_profiles.user_id = auth.uid()
        )
    );

CREATE POLICY "runner_documents_insert_own" ON runner_documents
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM runner_profiles
            WHERE runner_profiles.id = runner_documents.runner_id
              AND runner_profiles.user_id = auth.uid()
        )
    );

-- ============================================
-- ERRAND_TYPES table policies (public read)
-- ============================================
CREATE POLICY "errand_types_select_all" ON errand_types
    FOR SELECT USING (TRUE);

-- ============================================
-- BOOKINGS table policies
-- ============================================
CREATE POLICY "bookings_select_customer" ON bookings
    FOR SELECT USING (customer_id = auth.uid());

CREATE POLICY "bookings_select_runner" ON bookings
    FOR SELECT USING (runner_id = auth.uid());

CREATE POLICY "bookings_insert_customer" ON bookings
    FOR INSERT WITH CHECK (customer_id = auth.uid());

-- ============================================
-- BOOKING_STATUS_LOGS table policies
-- ============================================
CREATE POLICY "booking_status_logs_select" ON booking_status_logs
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM bookings
            WHERE bookings.id = booking_status_logs.booking_id
              AND (bookings.customer_id = auth.uid() OR bookings.runner_id = auth.uid())
        )
    );

-- ============================================
-- RUNNER_LOCATIONS table policies
-- ============================================
CREATE POLICY "runner_locations_insert_own" ON runner_locations
    FOR INSERT WITH CHECK (runner_id = auth.uid());

CREATE POLICY "runner_locations_select_for_booking" ON runner_locations
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM bookings
            WHERE bookings.id = runner_locations.booking_id
              AND bookings.customer_id = auth.uid()
              AND bookings.status NOT IN ('completed', 'cancelled')
        )
    );

CREATE POLICY "runner_locations_select_own" ON runner_locations
    FOR SELECT USING (runner_id = auth.uid());

-- ============================================
-- PAYMENTS table policies
-- ============================================
CREATE POLICY "payments_select_own" ON payments
    FOR SELECT USING (customer_id = auth.uid());

-- ============================================
-- PAYMENT_METHODS table policies
-- ============================================
CREATE POLICY "payment_methods_select_own" ON payment_methods
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "payment_methods_insert_own" ON payment_methods
    FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "payment_methods_update_own" ON payment_methods
    FOR UPDATE USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "payment_methods_delete_own" ON payment_methods
    FOR DELETE USING (user_id = auth.uid());

-- ============================================
-- WALLET_TRANSACTIONS table policies
-- ============================================
CREATE POLICY "wallet_transactions_select_own" ON wallet_transactions
    FOR SELECT USING (user_id = auth.uid());

-- ============================================
-- MESSAGES table policies
-- ============================================
CREATE POLICY "messages_select_booking_participant" ON messages
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM bookings
            WHERE bookings.id = messages.booking_id
              AND (bookings.customer_id = auth.uid() OR bookings.runner_id = auth.uid())
        )
    );

CREATE POLICY "messages_insert_booking_participant" ON messages
    FOR INSERT WITH CHECK (
        sender_id = auth.uid() AND
        EXISTS (
            SELECT 1 FROM bookings
            WHERE bookings.id = messages.booking_id
              AND (bookings.customer_id = auth.uid() OR bookings.runner_id = auth.uid())
        )
    );

-- ============================================
-- REVIEWS table policies
-- ============================================
CREATE POLICY "reviews_select_own" ON reviews
    FOR SELECT USING (reviewer_id = auth.uid() OR reviewee_id = auth.uid());

CREATE POLICY "reviews_insert_own" ON reviews
    FOR INSERT WITH CHECK (reviewer_id = auth.uid());

-- ============================================
-- NOTIFICATIONS table policies
-- ============================================
CREATE POLICY "notifications_select_own" ON notifications
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "notifications_update_own" ON notifications
    FOR UPDATE USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- ============================================
-- SAVED_ADDRESSES table policies
-- ============================================
CREATE POLICY "saved_addresses_select_own" ON saved_addresses
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "saved_addresses_insert_own" ON saved_addresses
    FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "saved_addresses_update_own" ON saved_addresses
    FOR UPDATE USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "saved_addresses_delete_own" ON saved_addresses
    FOR DELETE USING (user_id = auth.uid());

-- ============================================
-- TRUSTED_CONTACTS table policies
-- ============================================
CREATE POLICY "trusted_contacts_select_own" ON trusted_contacts
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "trusted_contacts_insert_own" ON trusted_contacts
    FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "trusted_contacts_update_own" ON trusted_contacts
    FOR UPDATE USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "trusted_contacts_delete_own" ON trusted_contacts
    FOR DELETE USING (user_id = auth.uid());

-- ============================================
-- SOS_ALERTS table policies
-- ============================================
CREATE POLICY "sos_alerts_select_participant" ON sos_alerts
    FOR SELECT USING (customer_id = auth.uid() OR runner_id = auth.uid());

CREATE POLICY "sos_alerts_insert_customer" ON sos_alerts
    FOR INSERT WITH CHECK (customer_id = auth.uid());

-- ============================================
-- PROMO_CODES table policies (public read for active)
-- ============================================
CREATE POLICY "promo_codes_select_active" ON promo_codes
    FOR SELECT USING (is_active = TRUE);

-- ============================================
-- DISPUTE_TICKETS table policies
-- ============================================
CREATE POLICY "dispute_tickets_select_own" ON dispute_tickets
    FOR SELECT USING (reported_by = auth.uid());

CREATE POLICY "dispute_tickets_insert_own" ON dispute_tickets
    FOR INSERT WITH CHECK (reported_by = auth.uid());

-- ============================================
-- SYSTEM_CONFIG table policies (public read)
-- ============================================
CREATE POLICY "system_config_select_all" ON system_config
    FOR SELECT USING (TRUE);
