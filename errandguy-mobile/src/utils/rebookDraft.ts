import type { Booking } from '../types';
import type { DraftBooking } from '../stores/bookingStore';

/**
 * The booking draft for "Book again" on an errand that ended without being
 * done (no runner, cancelled, payment declined or refunded): the same errand,
 * re-seeded so the customer lands on Review with everything filled in and only
 * the things that matter for a second try — vehicle, timing, payment — left to
 * change.
 *
 * One builder for every screen that offers it. The tracking screen kept its own
 * copy, which never learned about multi-stop errands: rebooking from there
 * silently dropped every extra stop and re-priced the errand as a cheaper
 * single drop.
 */
export function rebookDraft(b: Booking, now: number = Date.now()): Partial<DraftBooking> {
  // Server clocks may have moved past a scheduled slot while we searched —
  // a stale scheduled_at would just 422 at resubmit.
  const scheduledAt = b.scheduled_at ? Date.parse(b.scheduled_at) : NaN;
  const scheduleStillValid =
    b.schedule_type === 'scheduled' && Number.isFinite(scheduledAt) && scheduledAt > now;

  return {
    errand_type_id: b.errand_type_id,
    errand_type_slug: b.errand_type?.slug,
    pickup_address: b.pickup_address,
    // Laravel casts decimal columns to strings — coerce so downstream
    // consumers (estimate payload, map cameras) see real numbers.
    pickup_lat: Number(b.pickup_lat),
    pickup_lng: Number(b.pickup_lng),
    pickup_contact_name: b.pickup_contact_name ?? undefined,
    pickup_contact_phone: b.pickup_contact_phone ?? undefined,
    dropoff_address: b.dropoff_address ?? undefined,
    dropoff_lat: b.dropoff_lat != null ? Number(b.dropoff_lat) : undefined,
    dropoff_lng: b.dropoff_lng != null ? Number(b.dropoff_lng) : undefined,
    dropoff_contact_name: b.dropoff_contact_name ?? undefined,
    dropoff_contact_phone: b.dropoff_contact_phone ?? undefined,
    description: b.description ?? undefined,
    special_instructions: b.special_instructions ?? undefined,
    estimated_item_value: b.estimated_item_value ?? undefined,
    shopping_budget: b.shopping_budget ?? undefined,
    shoppingItems: b.shopping_items?.length
      ? b.shopping_items.map((it) => ({ id: it.id, name: it.name, qty: it.qty ?? 1 }))
      : undefined,
    // Multi-stop extra destinations — without re-seeding these, rebooking a
    // multi-stop errand silently dropped every extra stop (pickup→dropoff
    // only), so the customer re-paid for a cheaper single-drop errand.
    stops: b.stops?.length
      ? b.stops.map((s) => ({
          address: s.address,
          lat: Number(s.lat),
          lng: Number(s.lng),
          contact_name: s.contact_name ?? undefined,
          contact_phone: s.contact_phone ?? undefined,
          note: s.note ?? undefined,
        }))
      : undefined,
    vehicle_type_rate: b.vehicle_type_rate ?? undefined,
    schedule_type: scheduleStillValid ? 'scheduled' : 'now',
    scheduled_at: scheduleStillValid ? b.scheduled_at ?? undefined : undefined,
  };
}
