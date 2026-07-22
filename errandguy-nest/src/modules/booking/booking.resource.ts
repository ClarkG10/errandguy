import type {
  Booking,
  BookingStatusLog,
  ErrandType,
  Payment,
  Review,
  RunnerProfile,
  User,
} from '@prisma/client';
import { dec, iso, asArray } from '../../common/serialization';
import { userResource } from '../../common/resources/user.resource';
import { RunnerProfileWithDocs } from '../../common/resources/runner-profile.resource';

/** Mirrors ErrandTypeResource (omits sort_order + created_at; money as raw decimal strings). */
export function errandTypeResource(e: ErrandType): Record<string, unknown> {
  return {
    id: e.id,
    slug: e.slug,
    name: e.name,
    description: e.description,
    icon_name: e.iconName,
    base_fee: dec(e.baseFee),
    per_km_walk: dec(e.perKmWalk),
    per_km_bicycle: dec(e.perKmBicycle),
    per_km_motorcycle: dec(e.perKmMotorcycle),
    per_km_car: dec(e.perKmCar),
    surcharge: dec(e.surcharge),
    min_negotiate_fee: dec(e.minNegotiateFee),
    is_active: e.isActive,
  };
}

const TRACKABLE = [
  'accepted',
  'heading_to_pickup',
  'arrived_at_pickup',
  'picked_up',
  'in_transit',
  'arrived_at_dropoff',
  'delivered',
];

export type BookingWithRelations = Booking & {
  errandType?: ErrandType | null;
  runner?: (User & { runnerProfile?: RunnerProfile | null }) | null;
  customer?: User | null;
  statusLogs?: BookingStatusLog[];
  payment?: Payment | null;
  review?: (Review & { reviewer?: User | null }) | null;
};

/** Mirrors BookingResource (contact/PIN/token visibility gated by participant/admin). */
export function bookingResource(
  b: BookingWithRelations,
  currentUserId?: string,
  isAdmin = false,
): Record<string, unknown> {
  const isParticipant = !!currentUserId && (currentUserId === b.customerId || currentUserId === b.runnerId);
  const canSeeContacts = isParticipant || isAdmin;

  const out: Record<string, unknown> = {
    id: b.id,
    booking_number: b.bookingNumber,
    customer_id: b.customerId,
    runner_id: b.runnerId,
    errand_type_id: b.errandTypeId,
    status: b.status,
    pickup_address: b.pickupAddress,
    pickup_lat: dec(b.pickupLat, 7),
    pickup_lng: dec(b.pickupLng, 7),
    dropoff_address: b.dropoffAddress,
    dropoff_lat: dec(b.dropoffLat, 7),
    dropoff_lng: dec(b.dropoffLng, 7),
    description: b.description,
    special_instructions: b.specialInstructions,
    item_photos: asArray(b.itemPhotos),
    estimated_item_value: dec(b.estimatedItemValue),
    shopping_budget: dec(b.shoppingBudget),
    shopping_items: b.shoppingItems ?? [],
    actual_item_cost: dec(b.actualItemCost),
    receipt_photo_url: b.receiptPhotoUrl,
    schedule_type: b.scheduleType,
    scheduled_at: iso(b.scheduledAt),
    pricing_mode: b.pricingMode,
    vehicle_type_rate: b.vehicleTypeRate,
    distance_km: dec(b.distanceKm),
    base_fee: dec(b.baseFee),
    distance_fee: dec(b.distanceFee),
    service_fee: dec(b.serviceFee),
    surcharge: dec(b.surcharge),
    promo_discount: dec(b.promoDiscount),
    total_amount: dec(b.totalAmount),
    customer_offer: dec(b.customerOffer),
    runner_payout: dec(b.runnerPayout),
    negotiate_expires_at: iso(b.negotiateExpiresAt),
    is_transportation: b.isTransportation,
    ride_pin_verified: b.ridePinVerified,
    pickup_photo_url: b.pickupPhotoUrl,
    delivery_photo_url: b.deliveryPhotoUrl,
    signature_url: b.signatureUrl,
    matched_at: iso(b.matchedAt),
    accepted_at: iso(b.acceptedAt),
    picked_up_at: iso(b.pickedUpAt),
    completed_at: iso(b.completedAt),
    cancelled_at: iso(b.cancelledAt),
    cancellation_reason: b.cancellationReason,
    cancellation_fee: dec(b.cancellationFee),
    trip_share_active: b.tripShareActive,
    can_cancel: ['pending', 'matched', 'accepted'].includes(b.status),
    is_trackable: TRACKABLE.includes(b.status),
    created_at: iso(b.createdAt),
    updated_at: iso(b.updatedAt),
  };

  if (canSeeContacts) {
    out.pickup_contact_name = b.pickupContactName;
    out.pickup_contact_phone = b.pickupContactPhone;
    out.dropoff_contact_name = b.dropoffContactName;
    out.dropoff_contact_phone = b.dropoffContactPhone;
  }
  if (b.isTransportation && isParticipant) out.ride_pin = b.ridePin;
  if (b.tripShareActive && isParticipant) out.trip_share_token = b.tripShareToken;

  if (b.errandType) out.errand_type = errandTypeResource(b.errandType);
  if (b.runner) {
    out.runner = userResource(
      b.runner as User & { runnerProfile?: RunnerProfileWithDocs | null },
      currentUserId,
    );
  }
  if (b.customer) out.customer = userResource(b.customer, currentUserId);
  if (b.statusLogs) {
    out.status_logs = b.statusLogs.map((log) => ({
      status: log.status,
      note: log.note,
      created_at: iso(log.createdAt),
    }));
  }
  if (b.payment) {
    out.payment = {
      id: b.payment.id,
      amount: dec(b.payment.amount),
      method: b.payment.method,
      status: b.payment.status,
      paid_at: iso(b.payment.paidAt),
    };
  }
  if (b.review) {
    out.review = {
      id: b.review.id,
      rating: b.review.rating,
      comment: b.review.comment,
      ...(b.review.reviewer ? { reviewer: userResource(b.review.reviewer, currentUserId) } : {}),
      created_at: iso(b.review.createdAt),
    };
  }
  return out;
}

/** Full include for a fully-detailed booking (show/track/active). */
export const BOOKING_FULL_INCLUDE = {
  errandType: true,
  runner: { include: { runnerProfile: true } },
  customer: true,
  statusLogs: { orderBy: { createdAt: 'asc' } },
  payment: true,
  review: { include: { reviewer: true } },
} as const;
