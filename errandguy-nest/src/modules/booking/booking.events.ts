import type { Booking } from '@prisma/client';

export const BookingEvents = {
  Created: 'booking.created',
  StatusChanged: 'booking.status_changed',
  Cancelled: 'booking.cancelled',
  RideDurationAlert: 'safety.ride_duration_alert',
  RouteDeviationAlert: 'safety.route_deviation_alert',
} as const;

export interface BookingCreatedPayload {
  booking: Booking;
}
export interface BookingStatusChangedPayload {
  booking: Booking;
  oldStatus: string;
  newStatus: string;
}
export interface BookingCancelledPayload {
  booking: Booking;
}
export interface RideDurationAlertPayload {
  booking: Booking;
  elapsedMinutes: number;
  estimatedMinutes: number;
}
export interface RouteDeviationAlertPayload {
  booking: Booking;
  deviationMeters: number;
}
