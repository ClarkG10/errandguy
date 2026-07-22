import type { SosAlert } from '@prisma/client';
import { dec, iso, asArray } from '../../common/serialization';

/**
 * Serializes a SosAlert the way Laravel's raw model does for the SOS controllers
 * (there is no API Resource — the controller returns the model directly). Mirrors
 * the attributes present on a freshly-created alert with the model's casts applied
 * (`decimal:7` lat/lng → strings, datetimes → ISO, `contacts_notified` → array).
 */
export function sosAlertResource(a: SosAlert): Record<string, unknown> {
  return {
    id: a.id,
    booking_id: a.bookingId,
    customer_id: a.customerId,
    runner_id: a.runnerId,
    triggered_by: a.triggeredBy,
    triggered_by_role: a.triggeredByRole,
    triggered_at: iso(a.triggeredAt),
    customer_lat: dec(a.customerLat, 7),
    customer_lng: dec(a.customerLng, 7),
    runner_lat: dec(a.runnerLat, 7),
    runner_lng: dec(a.runnerLng, 7),
    contacts_notified: asArray(a.contactsNotified),
    live_link_token: a.liveLinkToken,
    live_link_expires_at: iso(a.liveLinkExpiresAt),
    status: a.status,
  };
}
