import type { Referral, User } from '@prisma/client';
import { toFloat, iso } from '../../common/serialization';
import { userResource } from '../../common/resources/user.resource';

type ReferralWithReferee = Referral & { referee?: User | null };

/** Mirrors ReferralResource. `referee` only when the relation is loaded + non-null. */
export function referralResource(
  r: ReferralWithReferee,
  currentUserId?: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: r.id,
    referrer_id: r.referrerId,
    referee_id: r.refereeId,
    status: r.status,
    reward_amount: toFloat(r.rewardAmount),
    qualified_at: iso(r.qualifiedAt),
    rewarded_at: iso(r.rewardedAt),
    created_at: iso(r.createdAt),
  };
  if (r.referee) {
    out.referee = userResource(r.referee, currentUserId);
  }
  return out;
}
