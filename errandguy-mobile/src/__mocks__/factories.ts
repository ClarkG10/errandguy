import type { User } from '../types';
import type { Booking } from '../types';
import type { RunnerProfile } from '../types';

export function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-001',
    phone: '+639171234567',
    email: 'test@example.com',
    full_name: 'Test User',
    avatar_url: null,
    role: 'customer',
    status: 'active',
    email_verified: true,
    phone_verified: true,
    default_lat: null,
    default_lng: null,
    fcm_token: null,
    wallet_balance: 500,
    avg_rating: 4.8,
    total_ratings: 10,
    last_active_at: '2026-03-31T00:00:00.000Z',
    deleted_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-03-31T00:00:00.000Z',
    ...overrides,
  };
}

export function makeRunner(overrides: Partial<User> = {}): User {
  return makeUser({ role: 'runner', ...overrides });
}

export function makeBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 'booking-001',
    booking_number: 'EG-2026-00001',
    customer_id: 'user-001',
    runner_id: null,
    errand_type_id: 'errand-type-001',
    status: 'pending',
    pickup_address: '123 Pickup St, Manila',
    pickup_lat: 14.5995,
    pickup_lng: 120.9842,
    pickup_contact_name: null,
    pickup_contact_phone: null,
    dropoff_address: '456 Dropoff Ave, Quezon City',
    dropoff_lat: 14.6760,
    dropoff_lng: 121.0437,
    dropoff_contact_name: null,
    dropoff_contact_phone: null,
    description: 'Test booking description',
    special_instructions: null,
    item_photos: [],
    estimated_item_value: null,
    schedule_type: 'now',
    scheduled_at: null,
    pricing_mode: 'fixed',
    vehicle_type_rate: 'motorcycle',
    customer_offer: null,
    base_fee: 50,
    distance_fee: 30,
    surcharge: 0,
    service_fee: 12,
    total_amount: 92,
    runner_payout: 68,
    distance_km: 5,
    promo_code: null,
    promo_discount: 0,
    ride_pin: null,
    cancel_reason: null,
    cancelled_by: null,
    cancelled_by_role: null,
    trip_share_token: null,
    trip_share_expires_at: null,
    picked_up_at: null,
    delivered_at: null,
    completed_at: null,
    cancelled_at: null,
    created_at: '2026-03-31T00:00:00.000Z',
    updated_at: '2026-03-31T00:00:00.000Z',
    ...overrides,
  } as unknown as Booking;
}

export function makeRunnerProfile(overrides: Partial<RunnerProfile> = {}): RunnerProfile {
  return {
    id: 'rp-001',
    user_id: 'user-001',
    verification_status: 'approved',
    is_online: false,
    current_lat: null,
    current_lng: null,
    acceptance_rate: 95,
    completion_rate: 98,
    avg_rating: 4.9,
    total_errands: 120,
    preferred_types: ['delivery', 'grocery'],
    vehicle_type: 'motorcycle',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-03-31T00:00:00.000Z',
    ...overrides,
  } as unknown as RunnerProfile;
}
