import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, Booking, ErrandType, User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../cache/cache.service';
import { SupabaseStorageService } from '../../integrations/supabase-storage.service';
import { LaravelValidationException, ValidationErrors } from '../../common/exceptions/validation.exception';
import { BookingService } from '../booking/booking.service';
import { PaymentStatus, canTransitionTo, transitionPayment } from '../payment/payment-status';

/** A multipart file as delivered by Multer. */
export interface MultipartFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

export interface StatusRequestFields {
  status?: string;
  note?: string | null;
  lat?: number | null;
  lng?: number | null;
  actual_item_cost?: number | null;
}

export interface StatusRequestFiles {
  pickup_photo?: MultipartFile;
  receipt_photo?: MultipartFile;
  delivery_photo?: MultipartFile;
  signature?: MultipartFile;
}

type BookingWithErrandType = Booking & { errandType?: ErrandType | null };

/** Relations needed to serialize an errand back to a runner. */
export const ERRAND_INCLUDE = {
  errandType: true,
  customer: true,
  statusLogs: { orderBy: { createdAt: 'asc' } },
} as const;

const STATUS_ORDER = [
  'accepted',
  'heading_to_pickup',
  'arrived_at_pickup',
  'picked_up',
  'in_transit',
  'arrived_at_dropoff',
  'delivered',
  'completed',
];
const TRANSPORT_STATUS_ORDER = [
  'accepted',
  'heading_to_pickup',
  'arrived_at_pickup',
  'picked_up',
  'in_transit',
  'arrived_at_dropoff',
  'completed',
];
const SINGLE_LOCATION_STATUS_ORDER = [
  'accepted',
  'heading_to_pickup',
  'arrived_at_pickup',
  'picked_up',
  'completed',
];
const SINGLE_LOCATION_SLUGS = ['queue', 'bills_payment'];
const SHOPPING_SLUGS = ['food', 'grocery', 'purchase', 'bills_payment'];

const ALLOWED_STATUSES = [
  'heading_to_pickup',
  'arrived_at_pickup',
  'picked_up',
  'in_transit',
  'arrived_at_dropoff',
  'delivered',
  'completed',
];

@Injectable()
export class RunnerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly storage: SupabaseStorageService,
    private readonly booking: BookingService,
  ) {}

  /** In-app notification row (Laravel Notification::create — no push). */
  private async notify(userId: string, title: string, body: string, type: string, data: Record<string, unknown>): Promise<void> {
    await this.prisma.notification.create({
      data: { userId, title, body, type, data: data as Prisma.InputJsonValue, isRead: false },
    });
  }

  private loadErrand(id: string): Promise<Booking> {
    return this.prisma.booking.findUniqueOrThrow({ where: { id }, include: ERRAND_INCLUDE });
  }

  // ── accept ────────────────────────────────────────────────────────────────
  async acceptErrand(user: User, id: string): Promise<Booking> {
    const profile = await this.prisma.runnerProfile.findUnique({ where: { userId: user.id } });
    if (!profile || !profile.isOnline || profile.verificationStatus !== 'approved') {
      throw new HttpException({ message: 'You must be online and approved to accept errands.' }, HttpStatus.UNPROCESSABLE_ENTITY);
    }

    let updated: Booking;
    let oldStatus: string;
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<{ id: string; status: string; runner_id: string | null; matched_at: Date | null }[]>(
          Prisma.sql`SELECT id, status, runner_id, matched_at FROM bookings WHERE id = ${id}::uuid FOR UPDATE LIMIT 1`,
        );
        const locked = rows[0];
        if (!locked) throw new Error('unavailable');
        if (!['pending', 'matched'].includes(locked.status)) throw new Error('unavailable');
        if (locked.runner_id && locked.runner_id !== user.id) throw new Error('unavailable');

        // Only OTHER active errands block acceptance — the booking being
        // accepted may already be `matched` to this runner.
        const hasActive = await tx.booking.findFirst({
          where: { runnerId: user.id, id: { not: locked.id }, status: { notIn: ['completed', 'cancelled', 'pending'] } },
          select: { id: true },
        });
        if (hasActive) throw new Error('has_active');

        const old = locked.status;
        const up = await tx.booking.update({
          where: { id: locked.id },
          data: { runnerId: user.id, status: 'accepted', matchedAt: locked.matched_at ?? new Date(), acceptedAt: new Date() },
        });
        return { booking: up, oldStatus: old };
      });
      updated = result.booking;
      oldStatus = result.oldStatus;
    } catch (e) {
      const message = (e as Error).message === 'has_active'
        ? 'You already have an active errand. Complete it first.'
        : 'This booking is no longer available.';
      throw new HttpException({ message }, HttpStatus.UNPROCESSABLE_ENTITY);
    }

    await this.booking.logStatusChange(updated.id, 'accepted', user.id, `Accepted by runner ${user.fullName}`);
    // Bust the per-runner active-booking cache so the next GPS tick tags the new ride.
    this.cache.forget(`runner_active_booking_id:${user.id}`);
    await this.notify(updated.customerId, 'Runner Assigned!', `${user.fullName} accepted your errand.`, 'booking_update', { booking_id: updated.id });
    this.booking.emitStatusChanged(updated, oldStatus, 'accepted');

    return this.loadErrand(updated.id);
  }

  // ── decline ─────────────────────────────────────────────────────────────
  async declineErrand(user: User, id: string): Promise<void> {
    const booking = await this.prisma.booking.findUnique({ where: { id } });
    if (!booking) throw new HttpException({ message: 'Not found.' }, HttpStatus.NOT_FOUND);

    const profile = await this.prisma.runnerProfile.findUnique({ where: { userId: user.id } });
    if (profile) {
      const totalOffers = Math.max(1, profile.totalErrands + 1);
      const newAcceptanceRate = Math.max(0, (Number(profile.acceptanceRate) * profile.totalErrands) / totalOffers);
      await this.prisma.runnerProfile.update({
        where: { id: profile.id },
        data: { acceptanceRate: new Prisma.Decimal(Math.round(newAcceptanceRate * 100) / 100) },
      });
    }

    if (booking.pricingMode === 'fixed' && booking.status === 'matched') {
      await this.prisma.booking.update({ where: { id: booking.id }, data: { status: 'pending', runnerId: null, matchedAt: null } });
      // Exclude the decliner from the re-match, else the nearest-runner sort
      // re-offers the identical booking to them and decline is a no-op.
      await this.booking.enqueueMatch(booking.id, 0, undefined, user.id);
    }
  }

  // ── verify PIN ────────────────────────────────────────────────────────────
  async verifyPin(user: User, id: string, pin: unknown): Promise<{ message: string }> {
    if (pin === undefined || pin === null || pin === '') {
      throw new LaravelValidationException({ pin: ['The pin field is required.'] });
    }
    if (!/^\d{4}$/.test(String(pin))) {
      throw new LaravelValidationException({ pin: ['The pin must be 4 digits.'] });
    }

    const booking = await this.prisma.booking.findUnique({ where: { id } });
    if (!booking) throw new HttpException({ message: 'Not found.' }, HttpStatus.NOT_FOUND);
    if (user.id !== booking.runnerId) {
      throw new HttpException({ message: 'You are not assigned to this errand.' }, HttpStatus.FORBIDDEN);
    }
    if (!booking.isTransportation) {
      throw new HttpException({ message: 'PIN verification is only for transportation errands.' }, HttpStatus.UNPROCESSABLE_ENTITY);
    }
    if (booking.ridePinVerified) {
      return { message: 'PIN already verified.' };
    }

    const attemptKey = `pin_attempts:${booking.id}`;
    const attempts = Number(this.cache.get<number>(attemptKey) ?? 0);
    if (attempts >= 3) {
      throw new HttpException({ message: 'Maximum PIN attempts exceeded. Please contact support.' }, HttpStatus.UNPROCESSABLE_ENTITY);
    }
    if (String(pin) !== booking.ridePin) {
      this.cache.put(attemptKey, attempts + 1, 1800);
      throw new HttpException({ message: `Incorrect PIN. ${2 - attempts} attempts remaining.` }, HttpStatus.UNPROCESSABLE_ENTITY);
    }

    await this.prisma.booking.update({ where: { id: booking.id }, data: { ridePinVerified: true } });
    await this.booking.logStatusChange(booking.id, booking.status, user.id, 'Ride PIN verified');
    await this.notify(booking.customerId, 'PIN Verified', 'Your ride PIN has been verified. Have a safe trip!', 'booking_update', { booking_id: booking.id });

    return { message: 'PIN verified successfully.' };
  }

  // ── update status ─────────────────────────────────────────────────────────
  async updateErrandStatus(user: User, id: string, fields: StatusRequestFields, files: StatusRequestFiles): Promise<Booking> {
    const booking = await this.prisma.booking.findUnique({ where: { id }, include: { errandType: true } });

    // FormRequest-equivalent validation (booking may be null → lenient rules,
    // matching the controller's later findOrFail 404).
    this.validateStatusRequest(fields, files, booking);

    if (!booking) throw new HttpException({ message: 'Not found.' }, HttpStatus.NOT_FOUND);
    if (user.id !== booking.runnerId) {
      throw new HttpException({ message: 'You are not assigned to this errand.' }, HttpStatus.FORBIDDEN);
    }

    const newStatus = fields.status!;
    const oldStatus = booking.status;
    if (!this.isValidTransition(oldStatus, newStatus, booking)) {
      throw new HttpException(
        { message: `Invalid status transition from '${oldStatus}' to '${newStatus}' for this errand type.` },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    // Uploads happen BEFORE the DB transaction (mirrors the controller).
    const updateData: Prisma.BookingUpdateInput = { status: newStatus };
    if (newStatus === 'picked_up' && files.pickup_photo) {
      updateData.pickupPhotoUrl = await this.storage.uploadDeliveryProof(booking.id, 'pickup', files.pickup_photo);
      updateData.pickedUpAt = new Date();
    }
    if (newStatus === 'picked_up' && files.receipt_photo) {
      updateData.receiptPhotoUrl = await this.storage.uploadDeliveryProof(booking.id, 'receipt', files.receipt_photo);
    }
    if (newStatus === 'picked_up' && fields.actual_item_cost != null) {
      updateData.actualItemCost = new Prisma.Decimal(fields.actual_item_cost);
    }
    // Defensive server-side hard-cap on the reported cost.
    if (updateData.actualItemCost != null && booking.shoppingBudget !== null && Number(fields.actual_item_cost) > Number(booking.shoppingBudget)) {
      throw new HttpException(
        { message: 'Reported amount exceeds the customer’s pre-authorized budget.' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (newStatus === 'picked_up' && updateData.pickedUpAt == null) {
      updateData.pickedUpAt = new Date();
    }
    if (newStatus === 'delivered' && files.delivery_photo) {
      updateData.deliveryPhotoUrl = await this.storage.uploadDeliveryProof(booking.id, 'delivery', files.delivery_photo);
    }
    if (newStatus === 'completed' && files.signature) {
      updateData.signatureUrl = await this.storage.uploadDeliveryProof(booking.id, 'signature', files.signature);
    }
    if (newStatus === 'completed') {
      updateData.completedAt = new Date();
    }

    const statusLabel = this.humanizeStatus(newStatus);

    const updated = await this.prisma.$transaction(async (tx) => {
      const up = await tx.booking.update({ where: { id: booking.id }, data: updateData });

      await tx.bookingStatusLog.create({
        data: {
          bookingId: booking.id,
          status: newStatus,
          changedBy: user.id,
          note: fields.note ?? null,
          lat: fields.lat ?? null,
          lng: fields.lng ?? null,
        },
      });

      await tx.notification.create({
        data: {
          userId: booking.customerId,
          title: 'Errand Update',
          body: `Your errand is now: ${statusLabel}`,
          type: 'booking_update',
          data: { booking_id: booking.id } as Prisma.InputJsonValue,
          isRead: false,
        },
      });

      if (newStatus === 'completed') {
        await this.handleCompletion(tx, up, user);
      }

      if (['completed', 'cancelled', 'no_runner'].includes(newStatus)) {
        this.cache.forget(`runner_active_booking_id:${user.id}`);
      }

      return up;
    });

    this.booking.emitStatusChanged(updated, oldStatus, newStatus);

    return this.loadErrand(booking.id);
  }

  /**
   * Completion: settlement, runner stats, audited payment mark. Mirrors
   * Laravel RunnerErrandController::handleCompletion.
   *
   * Settlement is a function of what was ACTUALLY collected, never of status
   * alone (that was the critical money leak):
   *   - paid (wallet/online): platform holds the funds → credit the payout as
   *     a withdrawable 'earning'.
   *   - cash: the runner collected the full fare in person → they keep it and
   *     OWE the platform its service fee, recorded as a negative 'commission'
   *     that nets against their balance (may go negative — that debt is the point).
   *   - unsettled online (expired/failed): nobody collected → credit nothing.
   */
  private async handleCompletion(tx: Prisma.TransactionClient, booking: Booking, user: User): Promise<void> {
    const profile = await tx.runnerProfile.findUnique({ where: { userId: user.id } });
    if (!profile) return;

    const payoutAmount = new Prisma.Decimal(booking.runnerPayout ?? 0);

    // Idempotency guard: settled already for this runner via an 'earning'
    // credit OR a cash 'commission' debit → never settle twice.
    const alreadySettled = await tx.walletTransaction.findFirst({
      where: { userId: user.id, referenceId: booking.id, type: { in: ['earning', 'commission'] } },
      select: { id: true },
    });
    if (alreadySettled) {
      await this.markPaymentCompleted(tx, booking.id, user.id);
      return;
    }

    // Lock the runner row to serialize concurrent balance writes.
    const rows = await tx.$queryRaw<{ wallet_balance: Prisma.Decimal }[]>(
      Prisma.sql`SELECT wallet_balance FROM users WHERE id = ${user.id}::uuid FOR UPDATE LIMIT 1`,
    );
    const balance = new Prisma.Decimal(rows[0].wallet_balance);
    let earnedForStats = new Prisma.Decimal(0);
    let collected = false;

    if (booking.paymentStatus === 'paid') {
      const newBalance = balance.plus(payoutAmount);
      await tx.walletTransaction.create({
        data: {
          userId: user.id,
          type: 'earning',
          amount: payoutAmount,
          balanceAfter: newBalance,
          referenceId: booking.id,
          description: `Earning for errand #${booking.bookingNumber}`,
        },
      });
      await tx.user.update({ where: { id: user.id }, data: { walletBalance: newBalance } });
      earnedForStats = payoutAmount;
      collected = true;
    } else if (booking.paymentMethod === 'cash') {
      // Runner nets their payout in cash; the platform is owed the service fee.
      const commission = new Prisma.Decimal(booking.serviceFee ?? 0).toDecimalPlaces(2);
      const newBalance = balance.minus(commission);
      await tx.walletTransaction.create({
        data: {
          userId: user.id,
          type: 'commission',
          amount: commission.negated(),
          balanceAfter: newBalance,
          referenceId: booking.id,
          description: `Platform commission for cash errand #${booking.bookingNumber}`,
        },
      });
      await tx.user.update({ where: { id: user.id }, data: { walletBalance: newBalance } });
      earnedForStats = payoutAmount; // earned in cash, in person
      collected = true;
    }
    // else: unsettled online payment — nothing collected, credit nothing.

    const newTotalErrands = profile.totalErrands + 1;
    const newTotalEarnings = new Prisma.Decimal(profile.totalEarnings).plus(earnedForStats);

    const completedCount = await tx.booking.count({ where: { runnerId: user.id, status: 'completed' } });
    const totalAssigned = await tx.booking.count({ where: { runnerId: user.id, status: { in: ['completed', 'cancelled'] } } });
    const completionRate = totalAssigned > 0 ? Math.round((completedCount / totalAssigned) * 100 * 100) / 100 : 100.0;

    await tx.runnerProfile.update({
      where: { id: profile.id },
      data: {
        totalErrands: newTotalErrands,
        totalEarnings: newTotalEarnings,
        completionRate: new Prisma.Decimal(completionRate),
      },
    });

    // Only mark the payment settled when money was actually collected — an
    // unsettled online charge must NOT be laundered to 'completed'.
    if (collected) {
      await this.markPaymentCompleted(tx, booking.id, user.id);
    }
  }

  /**
   * Move the booking's payment to Completed through the audited
   * transitionPayment funnel — never a raw update, which would skip the
   * payment_status_transitions audit row and could launder an illegal
   * failed/expired → completed move with a fabricated paidAt. No-ops safely
   * when the payment is null, already completed, or cannot legally advance.
   */
  private async markPaymentCompleted(tx: Prisma.TransactionClient, bookingId: string, actorId: string): Promise<void> {
    const payment = await tx.payment.findFirst({ where: { bookingId }, orderBy: { createdAt: 'asc' } });
    if (!payment) return;
    if (!canTransitionTo(payment.status, PaymentStatus.Completed)) return;
    await transitionPayment(tx, payment, PaymentStatus.Completed, {
      actor: actorId,
      reason: 'Errand completed',
      extra: { paidAt: new Date() },
    });
  }

  // ── status-flow helpers ─────────────────────────────────────────────────
  private statusOrderFor(booking: BookingWithErrandType): string[] {
    if (booking.isTransportation) return TRANSPORT_STATUS_ORDER;
    const slug = booking.errandType?.slug;
    if (slug && SINGLE_LOCATION_SLUGS.includes(slug)) return SINGLE_LOCATION_STATUS_ORDER;
    return STATUS_ORDER;
  }

  private isValidTransition(current: string, next: string, booking: BookingWithErrandType): boolean {
    const order = this.statusOrderFor(booking);
    const currentIndex = order.indexOf(current);
    const nextIndex = order.indexOf(next);
    if (currentIndex === -1 || nextIndex === -1) return false;
    return nextIndex === currentIndex + 1;
  }

  private humanizeStatus(status: string): string {
    const ucfirst = status.charAt(0).toUpperCase() + status.slice(1);
    return ucfirst.replace(/_/g, ' ');
  }

  // ── validation ───────────────────────────────────────────────────────────
  private validateStatusRequest(fields: StatusRequestFields, files: StatusRequestFiles, booking: BookingWithErrandType | null): void {
    const errors: ValidationErrors = {};
    const slug = booking?.errandType?.slug ?? null;
    const isShopping = !!slug && SHOPPING_SLUGS.includes(slug);
    const isSingleLocation = !!slug && SINGLE_LOCATION_SLUGS.includes(slug);
    const skipPickupPhoto = !!slug && ['transportation', 'queue', 'bills_payment'].includes(slug);
    const isTransport = booking?.isTransportation === true;
    const skipDeliveryProof = isSingleLocation || isTransport;
    const budget = booking?.shoppingBudget != null ? Number(booking.shoppingBudget) : null;

    const status = fields.status;
    if (status === undefined || status === null || status === '') {
      errors.status = ['The status field is required.'];
    } else if (!ALLOWED_STATUSES.includes(status)) {
      errors.status = ['The selected status is invalid.'];
    }

    if (fields.note != null && String(fields.note).length > 300) {
      errors.note = ['The note field must not be greater than 300 characters.'];
    }
    if (fields.lat != null && (Number.isNaN(fields.lat) || fields.lat < -90 || fields.lat > 90)) {
      errors.lat = ['The lat field must be between -90 and 90.'];
    }
    if (fields.lng != null && (Number.isNaN(fields.lng) || fields.lng < -180 || fields.lng > 180)) {
      errors.lng = ['The lng field must be between -180 and 180.'];
    }

    if (!skipPickupPhoto && status === 'picked_up' && !files.pickup_photo) {
      errors.pickup_photo = ['A pickup photo is required when marking as picked up.'];
    }
    if (!skipDeliveryProof && status === 'delivered' && !files.delivery_photo) {
      errors.delivery_photo = ['A delivery photo is required when marking as delivered.'];
    }
    if (!skipDeliveryProof && status === 'completed' && !files.signature) {
      errors.signature = ['A signature is required when marking as completed.'];
    }

    if (isShopping && status === 'picked_up' && fields.actual_item_cost == null) {
      errors.actual_item_cost = ['Please enter the actual amount you paid for the items.'];
    }
    if (fields.actual_item_cost != null) {
      if (Number.isNaN(fields.actual_item_cost) || fields.actual_item_cost < 0) {
        errors.actual_item_cost = ['The actual item cost field must be at least 0.'];
      } else if (budget !== null && fields.actual_item_cost > budget) {
        errors.actual_item_cost = ['Amount cannot exceed the customer’s pre-authorized budget.'];
      } else if (budget === null && fields.actual_item_cost > 1000000) {
        errors.actual_item_cost = ['The actual item cost field must not be greater than 1000000.'];
      }
    }
    if (isShopping && status === 'picked_up' && !files.receipt_photo) {
      errors.receipt_photo = ['A photo of the receipt is required for shopping errands.'];
    }

    // Image type / size guards for any supplied proof file.
    const imageFields: [keyof StatusRequestFiles, string][] = [
      ['pickup_photo', 'pickup photo'],
      ['delivery_photo', 'delivery photo'],
      ['signature', 'signature'],
      ['receipt_photo', 'receipt photo'],
    ];
    for (const [field, label] of imageFields) {
      const file = files[field];
      if (!file) continue;
      if (!file.mimetype.startsWith('image/')) {
        errors[field] = [`The ${label} field must be an image.`];
      } else if (file.size > 5120 * 1024) {
        errors[field] = [`The ${label} field must not be greater than 5120 kilobytes.`];
      }
    }

    if (Object.keys(errors).length) throw new LaravelValidationException(errors);
  }
}
