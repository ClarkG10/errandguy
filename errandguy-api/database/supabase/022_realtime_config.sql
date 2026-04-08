-- Supabase Realtime Configuration
-- Run this in the Supabase SQL Editor after creating all tables

-- Enable Realtime for messages table (chat messages)
ALTER PUBLICATION supabase_realtime ADD TABLE messages;

-- Enable Realtime for runner_locations table (live tracking)
ALTER PUBLICATION supabase_realtime ADD TABLE runner_locations;

-- Enable Realtime for bookings table (status updates)
ALTER PUBLICATION supabase_realtime ADD TABLE bookings;

-- Enable Realtime for notifications table (push notifications)
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

-- Channel naming convention (for reference, configured in client code):
-- booking:{bookingId} — booking status updates + runner location
-- chat:{bookingId}   — chat messages
-- user:{userId}      — notifications, incoming requests
