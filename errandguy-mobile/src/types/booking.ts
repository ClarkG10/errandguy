export type BookingStatus =
  | 'pending'
  | 'matched'
  | 'accepted'
  | 'heading_to_pickup'
  | 'arrived_at_pickup'
  | 'picked_up'
  | 'in_transit'
  | 'arrived_at_dropoff'
  | 'delivered'
  | 'completed'
  | 'cancelled';

export type PricingMode = 'fixed' | 'negotiate';

export type ScheduleType = 'now' | 'scheduled';

export interface ErrandType {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon_name: string;
  base_fee: number;
  per_km_walk: number;
  per_km_bicycle: number;
  per_km_motorcycle: number;
  per_km_car: number;
  surcharge: number;
  min_negotiate_fee: number;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

export interface Booking {
  id: string;
  booking_number: string;
  customer_id: string;
  runner_id: string | null;
  errand_type_id: string;
  status: BookingStatus;
  pickup_address: string;
  pickup_lat: number;
  pickup_lng: number;
  pickup_contact_name: string | null;
  pickup_contact_phone: string | null;
  dropoff_address: string;
  dropoff_lat: number;
  dropoff_lng: number;
  dropoff_contact_name: string | null;
  dropoff_contact_phone: string | null;
  description: string | null;
  special_instructions: string | null;
  item_photos: string[];
  estimated_item_value: number | null;
  schedule_type: ScheduleType;
  scheduled_at: string | null;
  pricing_mode: PricingMode;
  vehicle_type_rate: string | null;
  distance_km: number | null;
  base_fee: number;
  distance_fee: number;
  service_fee: number;
  surcharge: number;
  promo_discount: number;
  total_amount: number;
  customer_offer: number | null;
  recommended_min: number | null;
  recommended_max: number | null;
  runner_payout: number | null;
  negotiate_expires_at: string | null;
  pickup_photo_url: string | null;
  delivery_photo_url: string | null;
  signature_url: string | null;
  matched_at: string | null;
  accepted_at: string | null;
  picked_up_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  cancelled_by: string | null;
  promo_code_id: string | null;
  ride_pin: string | null;
  ride_pin_verified: boolean;
  is_transportation: boolean;
  sos_triggered: boolean;
  trip_share_token: string | null;
  trip_share_active: boolean;
  created_at: string;
  updated_at: string;
  // Relations (optional, populated when included)
  errand_type?: ErrandType;
}

export interface BookingStatusLog {
  id: string;
  booking_id: string;
  status: BookingStatus;
  changed_by: string | null;
  note: string | null;
  lat: number | null;
  lng: number | null;
  created_at: string;
}
