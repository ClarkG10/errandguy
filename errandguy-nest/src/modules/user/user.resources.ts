import type { SavedAddress, TrustedContact } from '@prisma/client';
import { dec, iso } from '../../common/serialization';

/** SavedAddress raw toArray() shape (no updated_at). */
export function savedAddressResource(a: SavedAddress): Record<string, unknown> {
  return {
    id: a.id,
    user_id: a.userId,
    label: a.label,
    address: a.address,
    lat: dec(a.lat, 7),
    lng: dec(a.lng, 7),
    is_default: a.isDefault,
    created_at: iso(a.createdAt),
  };
}

/** TrustedContact raw toArray() shape. */
export function trustedContactResource(c: TrustedContact): Record<string, unknown> {
  return {
    id: c.id,
    user_id: c.userId,
    name: c.name,
    phone: c.phone,
    relationship: c.relationship,
    priority: c.priority,
    is_active: c.isActive,
    created_at: iso(c.createdAt),
    updated_at: iso(c.updatedAt),
  };
}
