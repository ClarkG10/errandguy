import type { RunnerDocument, RunnerProfile } from '@prisma/client';
import { dec, iso, asArray } from '../serialization';
import { runnerDocumentResource } from './runner-document.resource';

export type RunnerProfileWithDocs = RunnerProfile & { documents?: RunnerDocument[] };

/**
 * Mirrors RunnerProfileResource. `[self]` keys are emitted only when the
 * requester owns the profile; `bank_account_number` is never exposed.
 */
export function runnerProfileResource(
  p: RunnerProfileWithDocs,
  currentUserId?: string,
): Record<string, unknown> {
  const isSelf = !!currentUserId && currentUserId === p.userId;
  const out: Record<string, unknown> = {
    id: p.id,
    user_id: p.userId,
    verification_status: p.verificationStatus,
    vehicle_type: p.vehicleType,
    vehicle_plate: p.vehiclePlate,
    vehicle_photo_url: p.vehiclePhotoUrl,
    is_online: p.isOnline,
    acceptance_rate: dec(p.acceptanceRate),
    completion_rate: dec(p.completionRate),
    total_errands: p.totalErrands,
    approved_at: iso(p.approvedAt),
  };
  if (isSelf) {
    out.current_lat = dec(p.currentLat, 7);
    out.current_lng = dec(p.currentLng, 7);
    out.last_location_at = iso(p.lastLocationAt);
    out.total_earnings = dec(p.totalEarnings);
    out.preferred_types = asArray(p.preferredTypes);
    out.working_area_lat = dec(p.workingAreaLat, 7);
    out.working_area_lng = dec(p.workingAreaLng, 7);
    out.working_area_radius = p.workingAreaRadius;
    out.bank_name = p.bankName;
    out.ewallet_number = p.ewalletNumber;
    if (p.documents) {
      out.documents = p.documents.map((d) => runnerDocumentResource(d));
    }
  }
  return out;
}
