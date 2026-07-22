import type { RunnerProfile, User } from '@prisma/client';
import { dec, iso } from '../serialization';
import { runnerProfileResource, RunnerProfileWithDocs } from './runner-profile.resource';

export type UserWithProfile = User & { runnerProfile?: RunnerProfile | null };

/**
 * Mirrors UserResource. `[self]` keys (email/status/*_verified/wallet_balance)
 * are OMITTED unless the requester is the same user — which, on public auth
 * routes where there is no authenticated principal, means they are always
 * omitted there.
 */
export function userResource(u: UserWithProfile, currentUserId?: string): Record<string, unknown> {
  const isSelf = !!currentUserId && currentUserId === u.id;
  const out: Record<string, unknown> = {
    id: u.id,
    phone: u.phone,
    full_name: u.fullName,
    avatar_url: u.avatarUrl,
    role: u.role,
    avg_rating: dec(u.avgRating),
    total_ratings: u.totalRatings,
    created_at: iso(u.createdAt),
  };
  if (isSelf) {
    out.email = u.email;
    out.status = u.status;
    out.email_verified = u.emailVerified;
    out.phone_verified = u.phoneVerified;
    out.wallet_balance = dec(u.walletBalance);
  }
  if (u.role === 'runner' && u.runnerProfile) {
    out.runner_profile = runnerProfileResource(
      u.runnerProfile as RunnerProfileWithDocs,
      currentUserId,
    );
  }
  return out;
}
