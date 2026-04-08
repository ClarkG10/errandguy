import type { BookingStatus } from '../types';

export const STATUS_LABELS: Record<BookingStatus, string> = {
  pending: 'Finding a Runner',
  matched: 'Runner Matched',
  accepted: 'Runner Accepted',
  heading_to_pickup: 'Heading to Pickup',
  arrived_at_pickup: 'Arrived at Pickup',
  picked_up: 'Picked Up',
  in_transit: 'In Transit',
  arrived_at_dropoff: 'Arrived at Drop-off',
  delivered: 'Delivered',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const STATUS_COLORS: Record<BookingStatus, string> = {
  pending: '#F59E0B',
  matched: '#2563EB',
  accepted: '#2563EB',
  heading_to_pickup: '#3B82F6',
  arrived_at_pickup: '#3B82F6',
  picked_up: '#3B82F6',
  in_transit: '#3B82F6',
  arrived_at_dropoff: '#3B82F6',
  delivered: '#22C55E',
  completed: '#22C55E',
  cancelled: '#EF4444',
};
