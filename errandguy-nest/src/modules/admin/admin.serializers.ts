import type { DisputeTicket, RunnerDocument, RunnerProfile, User, WalletTransaction } from '@prisma/client';
import { dec, iso } from '../../common/serialization';

/** Admin view of a user (raw model minus password_hash/fcm_token). */
export function adminUserRow(u: User): Record<string, unknown> {
  return {
    id: u.id,
    phone: u.phone,
    email: u.email,
    full_name: u.fullName,
    avatar_url: u.avatarUrl,
    role: u.role,
    status: u.status,
    email_verified: u.emailVerified,
    phone_verified: u.phoneVerified,
    wallet_balance: dec(u.walletBalance),
    avg_rating: dec(u.avgRating),
    total_ratings: u.totalRatings,
    last_active_at: iso(u.lastActiveAt),
    referral_code: u.referralCode,
    created_at: iso(u.createdAt),
    updated_at: iso(u.updatedAt),
  };
}

export function runnerDocumentRow(d: RunnerDocument): Record<string, unknown> {
  return {
    id: d.id,
    runner_id: d.runnerId,
    document_type: d.documentType,
    file_url: d.fileUrl,
    status: d.status,
    rejection_reason: d.rejectionReason,
    reviewed_by: d.reviewedBy,
    reviewed_at: iso(d.reviewedAt),
    created_at: iso(d.createdAt),
  };
}

export function runnerProfileRow(
  p: RunnerProfile & { user?: Partial<User> | null; documents?: RunnerDocument[] },
): Record<string, unknown> {
  return {
    id: p.id,
    user_id: p.userId,
    verification_status: p.verificationStatus,
    vehicle_type: p.vehicleType,
    vehicle_plate: p.vehiclePlate,
    is_online: p.isOnline,
    acceptance_rate: dec(p.acceptanceRate),
    completion_rate: dec(p.completionRate),
    total_errands: p.totalErrands,
    approved_at: iso(p.approvedAt),
    created_at: iso(p.createdAt),
    ...(p.user
      ? { user: { id: p.user.id, full_name: p.user.fullName, email: p.user.email, phone: p.user.phone, avatar_url: p.user.avatarUrl } }
      : {}),
    ...(p.documents ? { documents: p.documents.map(runnerDocumentRow) } : {}),
  };
}

export function walletTxRow(
  t: WalletTransaction & { user?: Partial<User> | null },
): Record<string, unknown> {
  return {
    id: t.id,
    user_id: t.userId,
    type: t.type,
    amount: dec(t.amount),
    balance_after: dec(t.balanceAfter),
    reference_id: t.referenceId,
    description: t.description,
    status: t.status,
    processed_at: iso(t.processedAt),
    failure_reason: t.failureReason,
    created_at: iso(t.createdAt),
    ...(t.user ? { user: { id: t.user.id, full_name: t.user.fullName, phone: t.user.phone } } : {}),
  };
}

export function disputeRow(
  d: DisputeTicket & {
    booking?: { id: string; bookingNumber: string } | null;
    reporter?: Partial<User> | null;
  },
): Record<string, unknown> {
  return {
    id: d.id,
    booking_id: d.bookingId,
    reported_by: d.reportedBy,
    category: d.category,
    description: d.description,
    status: d.status,
    resolution: d.resolution,
    resolved_by: d.resolvedBy,
    resolved_at: iso(d.resolvedAt),
    created_at: iso(d.createdAt),
    updated_at: iso(d.updatedAt),
    ...(d.booking ? { booking: { id: d.booking.id, booking_number: d.booking.bookingNumber } } : {}),
    ...(d.reporter ? { reporter: { id: d.reporter.id, full_name: d.reporter.fullName, email: d.reporter.email } } : {}),
  };
}
