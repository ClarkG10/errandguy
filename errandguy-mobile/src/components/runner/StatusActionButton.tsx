import React from 'react';
import { Button } from '../ui/Button';
import type { BookingStatus } from '../../types';

interface StatusActionButtonProps {
  status: BookingStatus;
  isTransportation?: boolean;
  pinVerified?: boolean;
  onPress: () => void;
  loading?: boolean;
}

const STATUS_ACTIONS: Record<string, string> = {
  accepted: 'Head to Pickup',
  heading_to_pickup: 'Arrived at Pickup',
  arrived_at_pickup: 'Pick Up Item',
  picked_up: 'Start Delivery',
  in_transit: 'Arrived at Drop-off',
  arrived_at_dropoff: 'Deliver Item',
  delivered: 'Complete Errand',
};

const TRANSPORT_ACTIONS: Record<string, string> = {
  accepted: 'Head to Passenger',
  heading_to_pickup: 'Arrived at Pickup',
  arrived_at_pickup: 'Start Ride',
  picked_up: 'In Transit',
  in_transit: 'Arriving',
  arrived_at_dropoff: 'Complete Ride',
};

const NEXT_STATUS: Record<string, string> = {
  accepted: 'heading_to_pickup',
  heading_to_pickup: 'arrived_at_pickup',
  arrived_at_pickup: 'picked_up',
  picked_up: 'in_transit',
  in_transit: 'arrived_at_dropoff',
  arrived_at_dropoff: 'delivered',
  delivered: 'completed',
};

export function getNextStatus(current: string): string | null {
  return NEXT_STATUS[current] ?? null;
}

export function StatusActionButton({
  status,
  isTransportation,
  pinVerified,
  onPress,
  loading,
}: StatusActionButtonProps) {
  const actions = isTransportation ? TRANSPORT_ACTIONS : STATUS_ACTIONS;
  const label = actions[status];

  if (!label) return null;

  // For transportation: disable ride start until PIN is verified
  const disabled =
    isTransportation &&
    status === 'arrived_at_pickup' &&
    !pinVerified;

  return (
    <Button
      title={label}
      onPress={onPress}
      loading={loading}
      disabled={disabled}
      fullWidth
    />
  );
}
