import { HttpException, HttpStatus, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, Booking } from '@prisma/client';
import { randomInt, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../cache/cache.service';
import { QueueService } from '../../queue/queue.service';
import { NotificationService } from '../../messaging/notification.service';
import { RealtimeService } from '../../messaging/realtime.service';
import { SupabaseStorageService, UploadFile } from '../../integrations/supabase-storage.service';
import { PaymentGatewayException } from '../../common/exceptions/payment-gateway.exception';
import { LaravelValidationException, ValidationErrors } from '../../common/exceptions/validation.exception';
import { PromoService, PromoInvalidError } from '../promo/promo.service';
import { PaymentService } from '../payment/payment.service';
import { PaymentMethodCatalog } from '../payment/payment-method-catalog';
import { SystemConfigService } from '../payment/system-config.service';
import { WalletService } from '../wallet/wallet.service';
import { PaymentStatus, transitionPayment } from '../payment/payment-status';
import { PricingService } from './pricing.service';
import { CancellationPolicy, CancellationPreview } from './cancellation.policy';
import { MatchingService } from './matching.service';
import { BookingEvents } from './booking.events';
import { BOOKING_FULL_INCLUDE } from './booking.resource';
import type { CreateBookingDto } from './dto/booking.dto';

const B36 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

@Injectable()
export class BookingService implements OnModuleInit {
  private readonly logger = new Logger('Booking');

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly promo: PromoService,
    private readonly payment: PaymentService,
    private readonly wallet: WalletService,
    private readonly matching: MatchingService,
    private readonly config: SystemConfigService,
    private readonly storage: SupabaseStorageService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationService,
    private readonly events: EventEmitter2,
    private readonly cache: CacheService,
    private readonly queue: QueueService,
    private readonly catalog: PaymentMethodCatalog,
  ) {}

  onModuleInit(): void {
    this.queue.registerHandler('match-runner', async (payload) =>
      this.matchRunner(
        payload.bookingId as string,
        (payload.radiusOverrideKm as number | null) ?? null,
        (payload.excludeUserId as string | null) ?? null,
      ),
    );
    this.queue.registerHandler('broadcast-runners', async (payload) =>
      this.broadcastToRunners(payload.bookingId as string),
    );
  }

  // ── helpers ─────────────────────────────────────────────────────────────
  private ymd(): string {
    const d = new Date();
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  private strRandom(n: number): string {
    let s = '';
    const bytes = randomBytes(n);
    for (let i = 0; i < n; i++) s += B36[bytes[i] % B36.length];
    return s;
  }
  async generateBookingNumber(): Promise<string> {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const number = `EG-${this.ymd()}-${this.strRandom(4)}`;
      const exists = await this.prisma.booking.findUnique({ where: { bookingNumber: number }, select: { id: true } });
      if (!exists) return number;
    }
  }
  generateRidePin(): string {
    return String(randomInt(0, 10000)).padStart(4, '0');
  }
  isValidTransition(current: string, next: string): boolean {
    const t: Record<string, string[]> = {
      pending: ['matched', 'cancelled', 'no_runner'],
      matched: ['accepted', 'cancelled'],
      accepted: ['heading_to_pickup', 'cancelled'],
      heading_to_pickup: ['arrived_at_pickup', 'cancelled'],
      arrived_at_pickup: ['picked_up'],
      picked_up: ['in_transit'],
      in_transit: ['arrived_at_dropoff'],
      arrived_at_dropoff: ['delivered'],
      delivered: ['completed'],
    };
    return (t[current] ?? []).includes(next);
  }
  async logStatusChange(bookingId: string, status: string, changedBy: string | null = null, note: string | null = null, lat: number | null = null, lng: number | null = null): Promise<void> {
    await this.prisma.bookingStatusLog.create({
      data: { bookingId, status, changedBy, note, lat, lng },
    });
  }
  emitStatusChanged(booking: Booking, oldStatus: string, newStatus: string): void {
    this.events.emit(BookingEvents.StatusChanged, { booking, oldStatus, newStatus });
  }

  // ── create ──────────────────────────────────────────────────────────────
  async create(
    user: { id: string; email: string | null },
    dto: CreateBookingDto,
    itemPhotos: UploadFile[] = [],
  ): Promise<{ data: Booking; checkoutUrl: string | null; paymentId: string | null }> {
    const errandType = await this.prisma.errandType.findUnique({ where: { id: dto.errand_type_id } });
    if (!errandType) throw new NotFoundException({ message: 'Not found.' });

    await this.validateCreate(user, dto, errandType);

    const dropoffLat = dto.dropoff_lat ?? dto.pickup_lat;
    const dropoffLng = dto.dropoff_lng ?? dto.pickup_lng;
    const dropoffAddress = dto.dropoff_address ?? dto.pickup_address;
    const vehicleType = dto.vehicle_type_rate ?? 'motorcycle';

    let pricing = await this.pricing.calculate(
      dto.errand_type_id,
      dto.pickup_lat,
      dto.pickup_lng,
      dropoffLat,
      dropoffLng,
      vehicleType,
      dto.schedule_type,
    );

    // Negotiate mode: the customer's offer IS the price they pay (the fixed
    // fare becomes reference-only). Applied BEFORE promo so a promo discounts
    // the offer. Parity with Laravel H11 — without this a negotiate booking is
    // charged the fixed fare and customer_offer is cosmetic.
    if (dto.pricing_mode === 'negotiate' && dto.customer_offer != null) {
      pricing = this.pricing.applyNegotiateOffer(pricing, dto.customer_offer);
    }

    let promoDiscount = 0;
    let promoCodeId: string | null = null;
    if (dto.promo_code) {
      try {
        const promo = await this.promo.validate(dto.promo_code, user.id, pricing.total_amount);
        promoDiscount = promo.discount;
        promoCodeId = promo.id;
      } catch (e) {
        if (e instanceof PromoInvalidError) throw new HttpException({ message: e.message }, HttpStatus.UNPROCESSABLE_ENTITY);
        throw e;
      }
    }

    const isTransportation = errandType.slug === 'transportation';
    const shoppingItems = dto.shopping_items?.length
      ? dto.shopping_items.map((it) => ({ id: randomBytes(16).toString('hex'), name: it.name, qty: it.qty ?? 1, checked: false, checked_at: null }))
      : undefined;

    let booking = await this.prisma.booking.create({
      data: {
        bookingNumber: await this.generateBookingNumber(),
        customerId: user.id,
        errandTypeId: dto.errand_type_id,
        status: 'pending',
        pickupAddress: dto.pickup_address,
        pickupLat: dto.pickup_lat,
        pickupLng: dto.pickup_lng,
        pickupContactName: dto.pickup_contact_name ?? null,
        pickupContactPhone: dto.pickup_contact_phone ?? null,
        dropoffAddress,
        dropoffLat,
        dropoffLng,
        dropoffContactName: dto.dropoff_contact_name ?? null,
        dropoffContactPhone: dto.dropoff_contact_phone ?? null,
        description: dto.description ?? null,
        specialInstructions: dto.special_instructions ?? null,
        estimatedItemValue: dto.estimated_item_value ?? null,
        shoppingBudget: dto.shopping_budget ?? null,
        shoppingItems: shoppingItems as Prisma.InputJsonValue | undefined,
        scheduleType: dto.schedule_type,
        scheduledAt: dto.scheduled_at ? new Date(dto.scheduled_at) : null,
        pricingMode: dto.pricing_mode,
        vehicleTypeRate: vehicleType,
        distanceKm: new Prisma.Decimal(pricing.distance_km),
        baseFee: new Prisma.Decimal(pricing.base_fee),
        distanceFee: new Prisma.Decimal(pricing.distance_fee),
        serviceFee: new Prisma.Decimal(pricing.service_fee),
        surcharge: new Prisma.Decimal(pricing.surcharge),
        promoDiscount: new Prisma.Decimal(promoDiscount),
        totalAmount: new Prisma.Decimal(pricing.total_amount - promoDiscount),
        customerOffer: dto.customer_offer != null ? new Prisma.Decimal(dto.customer_offer) : null,
        runnerPayout: new Prisma.Decimal(pricing.runner_payout),
        promoCodeId,
        ridePin: isTransportation ? this.generateRidePin() : null,
        isTransportation,
        paymentMethod: dto.payment_method,
      },
    });

    if (itemPhotos.length) {
      const urls: string[] = [];
      for (const file of itemPhotos.slice(0, 5)) {
        const url = await this.storage.uploadItemPhoto(booking.id, file);
        if (url) urls.push(url);
      }
      booking = await this.prisma.booking.update({ where: { id: booking.id }, data: { itemPhotos: urls } });
    }

    await this.logStatusChange(booking.id, 'pending', user.id, 'Booking created');
    if (promoCodeId) await this.promo.redeem(promoCodeId, booking.id);

    // ── payment ──
    const amount = Number(booking.totalAmount);
    let checkoutUrl: string | null = null;
    let paymentId: string | null = null;

    const savedMethod = dto.payment_method_id
      ? await this.prisma.paymentMethod.findFirst({
          where: { id: dto.payment_method_id, userId: user.id, status: 'active', gatewayRef: { not: null } },
        })
      : null;

    try {
      if (savedMethod) {
        const payment = await this.prisma.payment.create({
          data: { bookingId: booking.id, customerId: user.id, amount: new Prisma.Decimal(amount), currency: 'PHP', method: dto.payment_method, status: 'pending' },
        });
        paymentId = payment.id;
        const charge = await this.payment.chargeSavedMethod(savedMethod.gatewayRef!, amount, `booking-${payment.id}`, `ErrandGuy booking ${booking.bookingNumber}`);
        const chargeStatus = String(charge.status ?? '').toUpperCase();
        if (chargeStatus === 'SUCCEEDED') {
          await transitionPayment(this.prisma, payment, PaymentStatus.Completed, { extra: { gatewayTxId: charge.id ?? null, gatewayResponse: charge as Prisma.InputJsonValue, paidAt: new Date() } });
          await this.prisma.booking.update({ where: { id: booking.id }, data: { paymentStatus: 'paid' } });
        } else if (['FAILED', 'EXPIRED', 'VOIDED'].includes(chargeStatus)) {
          throw new Error('Charge was declined.');
        } else {
          await transitionPayment(this.prisma, payment, PaymentStatus.Processing, { extra: { gatewayTxId: charge.id ?? null, gatewayResponse: charge as Prisma.InputJsonValue } });
          await this.prisma.booking.update({ where: { id: booking.id }, data: { paymentStatus: 'pending' } });
          checkoutUrl = PaymentService.extractActionUrl(charge);
        }
      } else if (dto.payment_method === 'wallet') {
        try {
          await this.wallet.deduct(user.id, amount, booking.id, `Payment for booking ${booking.bookingNumber}`);
        } catch {
          await this.undoBooking(booking.id);
          throw new HttpException({ message: 'Insufficient wallet balance. Please add money or choose another payment method.' }, HttpStatus.UNPROCESSABLE_ENTITY);
        }
        const payment = await this.prisma.payment.create({
          data: { bookingId: booking.id, customerId: user.id, amount: new Prisma.Decimal(amount), currency: 'PHP', method: 'wallet', status: 'pending' },
        });
        paymentId = payment.id;
        await transitionPayment(this.prisma, payment, PaymentStatus.Completed, { extra: { paidAt: new Date() } });
        await this.prisma.booking.update({ where: { id: booking.id }, data: { paymentStatus: 'paid' } });
      } else if (dto.payment_method === 'cash') {
        const payment = await this.prisma.payment.create({
          data: { bookingId: booking.id, customerId: user.id, amount: new Prisma.Decimal(amount), currency: 'PHP', method: 'cash', status: 'pending' },
        });
        paymentId = payment.id;
        await this.prisma.booking.update({ where: { id: booking.id }, data: { paymentStatus: 'unpaid' } });
      } else {
        const payment = await this.prisma.payment.create({
          data: { bookingId: booking.id, customerId: user.id, amount: new Prisma.Decimal(amount), currency: 'PHP', method: dto.payment_method, status: 'pending' },
        });
        paymentId = payment.id;
        const invoice = await this.payment.createInvoice(amount, `booking-${payment.id}`, `ErrandGuy booking ${booking.bookingNumber}`, user.email ?? '', this.wallet.successRedirectUrl());
        await transitionPayment(this.prisma, payment, PaymentStatus.Processing, { extra: { gatewayTxId: invoice.id ?? null, gatewayResponse: invoice as Prisma.InputJsonValue } });
        checkoutUrl = invoice.invoice_url ?? null;
        await this.prisma.booking.update({ where: { id: booking.id }, data: { paymentStatus: 'pending' } });
      }
    } catch (e) {
      if (e instanceof HttpException) throw e; // wallet-insufficient already cleaned up
      // Gateway / charge failure → undo the booking, surface 422.
      await this.undoBooking(booking.id);
      const message =
        e instanceof PaymentGatewayException
          ? `Payment gateway error: ${e.reason()}`
          : savedMethod
            ? 'Could not charge your saved payment method. Please try another.'
            : 'Could not start payment. Please try again or choose another method.';
      this.logger.error(`Booking payment failed ${booking.bookingNumber}: ${(e as Error).message}`);
      throw new HttpException({ message }, HttpStatus.UNPROCESSABLE_ENTITY);
    }

    // ── matching / scheduling ──
    await this.dispatchMatching(booking, dto);

    this.events.emit(BookingEvents.Created, { booking });

    const full = await this.prisma.booking.findUnique({ where: { id: booking.id }, include: { errandType: true, statusLogs: { orderBy: { createdAt: 'asc' } } } });
    return { data: full!, checkoutUrl, paymentId };
  }

  /** Conditional (cross-field) validation from CreateBookingRequest + withValidator. */
  private async validateCreate(
    user: { id: string },
    dto: CreateBookingDto,
    errandType: { slug: string; minNegotiateFee: Prisma.Decimal },
  ): Promise<void> {
    const errors: ValidationErrors = {};
    const singleLocation = ['queue', 'bills_payment'].includes(errandType.slug);
    const shopping = ['food', 'grocery', 'purchase'].includes(errandType.slug);

    if (!singleLocation) {
      if (!dto.dropoff_address) errors.dropoff_address = ['The dropoff address field is required.'];
      if (dto.dropoff_lat == null) errors.dropoff_lat = ['The dropoff lat field is required.'];
      if (dto.dropoff_lng == null) errors.dropoff_lng = ['The dropoff lng field is required.'];
    }
    if (shopping && dto.shopping_budget == null) {
      errors.shopping_budget = ['The shopping budget field is required.'];
    }
    if (dto.schedule_type === 'scheduled') {
      if (!dto.scheduled_at) {
        errors.scheduled_at = ['The scheduled at field is required when schedule type is scheduled.'];
      } else {
        const when = new Date(dto.scheduled_at);
        if (when.getTime() <= Date.now() + 30 * 60 * 1000) {
          errors.scheduled_at = ['The scheduled at must be a date after +30 minutes.'];
        } else if (when.getTime() > Date.now() + 30 * 86400 * 1000) {
          errors.scheduled_at = ['Bookings can only be scheduled up to 30 days in advance.'];
        }
      }
    }
    if (dto.pricing_mode === 'fixed' && !dto.vehicle_type_rate) {
      errors.vehicle_type_rate = ['The vehicle type rate field is required when pricing mode is fixed.'];
    }
    if (dto.pricing_mode === 'negotiate') {
      if (dto.customer_offer == null) {
        errors.customer_offer = ['The customer offer field is required when pricing mode is negotiate.'];
      } else if (dto.customer_offer < Number(errandType.minNegotiateFee)) {
        errors.customer_offer = [`Minimum offer is ₱${errandType.minNegotiateFee.toString()}.`];
      }
    }
    if (dto.vehicle_type_rate) {
      const allowed =
        errandType.slug === 'transportation'
          ? ['motorcycle', 'car']
          : errandType.slug === 'food'
            ? ['bicycle', 'motorcycle', 'car']
            : ['walk', 'bicycle', 'motorcycle', 'car'];
      if (!allowed.includes(dto.vehicle_type_rate)) {
        errors.vehicle_type_rate = ['This vehicle is not available for the selected errand type.'];
      }
    }

    const savedTypes = (
      await this.prisma.paymentMethod.findMany({
        where: { userId: user.id, status: 'active' },
        select: { type: true },
      })
    ).map((m) => m.type);
    const allowedMethods = [...new Set([...(await this.catalog.enabledTypes()), ...savedTypes])];
    if (!allowedMethods.includes(dto.payment_method)) {
      errors.payment_method = ['The selected payment method is invalid.'];
    }
    if (dto.payment_method_id) {
      const owned = await this.prisma.paymentMethod.findFirst({
        where: { id: dto.payment_method_id, userId: user.id },
        select: { id: true },
      });
      if (!owned) errors.payment_method_id = ['The selected payment method id is invalid.'];
    }

    if (Object.keys(errors).length) throw new LaravelValidationException(errors);
  }

  private async undoBooking(bookingId: string): Promise<void> {
    await this.prisma.payment.deleteMany({ where: { bookingId } }).catch(() => undefined);
    await this.prisma.booking.delete({ where: { id: bookingId } }).catch(() => undefined);
  }

  private async dispatchMatching(booking: Booking, dto: CreateBookingDto): Promise<void> {
    const isScheduled = dto.schedule_type === 'scheduled' && !!dto.scheduled_at;
    const scheduledAt = isScheduled ? new Date(dto.scheduled_at!) : null;
    const matchAt = scheduledAt ? new Date(scheduledAt.getTime() - 15 * 60 * 1000) : null;
    const matchInFuture = matchAt !== null && matchAt.getTime() > Date.now();

    if (dto.pricing_mode === 'fixed') {
      if (matchInFuture) {
        await this.enqueueMatch(booking.id, matchAt!.getTime() - Date.now());
      } else {
        await this.matchRunner(booking.id).catch((e) => this.logger.error(`inline match failed: ${(e as Error).message}`));
      }
      // Auto-cancel handled by the @Cron sweep in BookingMaintenanceService.
    } else {
      const negotiateMinutes = Number((await this.config.getValue('negotiate_timeout_minutes', '5')) ?? '5');
      const broadcastAt = matchInFuture ? matchAt! : new Date();
      await this.prisma.booking.update({
        where: { id: booking.id },
        data: { negotiateExpiresAt: new Date(broadcastAt.getTime() + negotiateMinutes * 60 * 1000) },
      });
      if (matchInFuture) await this.enqueueBroadcast(booking.id, matchAt!.getTime() - Date.now());
      else await this.broadcastToRunners(booking.id).catch((e) => this.logger.error(`inline broadcast failed: ${(e as Error).message}`));
      // Expiry handled by the @Cron sweep.
    }
  }

  // ── job logic (also registered as queue handlers) ──
  async enqueueMatch(
    bookingId: string,
    delayMs: number,
    radiusOverrideKm?: number,
    excludeUserId?: string | null,
  ): Promise<void> {
    await this.queue.enqueue(
      'match-runner',
      { bookingId, radiusOverrideKm: radiusOverrideKm ?? null, excludeUserId: excludeUserId ?? null },
      delayMs,
    );
  }
  async enqueueBroadcast(bookingId: string, delayMs: number): Promise<void> {
    await this.queue.enqueue('broadcast-runners', { bookingId }, delayMs);
  }

  /** MatchRunnerJob logic. */
  async matchRunner(
    bookingId: string,
    radiusOverrideKm?: number | null,
    excludeUserId?: string | null,
  ): Promise<void> {
    const current = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!current || current.status !== 'pending') return;

    const runner = await this.matching.findRunner(bookingId, radiusOverrideKm, excludeUserId);

    const result = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Booking[]>(Prisma.sql`SELECT * FROM bookings WHERE id = ${bookingId}::uuid FOR UPDATE LIMIT 1`);
      const booking = rows[0];
      if (!booking || booking.status !== 'pending') return null;

      if (runner) {
        const busy = await tx.booking.findFirst({
          where: { runnerId: runner.userId, status: { notIn: ['pending', 'completed', 'cancelled', 'no_runner'] } },
          select: { id: true },
        });
        if (busy) return null; // chosen runner no longer free; leave pending
        const updated = await tx.booking.update({ where: { id: booking.id }, data: { runnerId: runner.userId, status: 'matched', matchedAt: new Date() } });
        await tx.bookingStatusLog.create({ data: { bookingId: booking.id, status: 'matched', changedBy: null, note: `Runner matched: ${runner.user.fullName ?? 'Unknown'}` } });
        return { booking: updated, newStatus: 'matched', runnerId: runner.userId };
      }
      const updated = await tx.booking.update({ where: { id: booking.id }, data: { status: 'no_runner' } });
      await tx.bookingStatusLog.create({ data: { bookingId: booking.id, status: 'no_runner', changedBy: null, note: 'No available runners found' } });
      return { booking: updated, newStatus: 'no_runner', runnerId: null };
    });

    if (result) {
      if (result.newStatus === 'matched' && result.runnerId) this.cache.forget(`runner_active_booking_id:${result.runnerId}`);
      this.emitStatusChanged(result.booking, 'pending', result.newStatus);

      // No runner was ever matched → return any money collected up front.
      if (result.newStatus === 'no_runner') {
        await this.refundUnfulfilled(bookingId, 'No runner available — auto-refund');
      }
    }
  }

  /**
   * Refund a booking that ended with NO runner ever matched (matchRunner →
   * no_runner, the auto-cancel timeout, or negotiate expiry). Full refund, no
   * cancellation fee (the customer was at no fault). Idempotent: only acts
   * while paymentStatus is 'paid', so a repeat call is a no-op; the idempotent
   * wallet refund + the DB unique index uq_wallet_tx_user_reference_type are
   * the double-refund backstops. Refunds to the wallet, matching cancel().
   * Parity with Laravel BookingService::refundUnfulfilled (H13).
   */
  async refundUnfulfilled(bookingId: string, reason: string): Promise<void> {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking || booking.paymentStatus !== 'paid') return;

    const refundable = Math.round(Number(booking.totalAmount) * 100) / 100;
    if (refundable > 0) {
      await this.wallet.refund(booking.customerId, refundable, booking.id);
      const payment = await this.prisma.payment.findFirst({
        where: { bookingId: booking.id, status: 'completed' },
        orderBy: { createdAt: 'desc' },
      });
      if (payment) {
        await transitionPayment(this.prisma, payment, PaymentStatus.Refunded, {
          actor: 'system',
          reason,
          meta: { refunded_to: 'wallet', unfulfilled: true },
          extra: { refundAmount: new Prisma.Decimal(refundable), refundedAt: new Date() },
        });
      }
    }
    await this.prisma.booking.update({ where: { id: booking.id }, data: { paymentStatus: 'refunded' } });
  }

  /** BroadcastToRunnersJob logic. */
  async broadcastToRunners(bookingId: string): Promise<void> {
    const runners = await this.matching.broadcastToRunners(bookingId);
    if (!runners.length) return;
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId }, include: { errandType: true } });
    if (!booking) return;
    const payload = {
      booking_id: booking.id,
      booking_number: booking.bookingNumber,
      errand_type: booking.errandType?.slug,
      pickup_address: booking.pickupAddress,
      dropoff_address: booking.dropoffAddress,
      customer_offer: booking.customerOffer ? Number(booking.customerOffer) : null,
      pricing_mode: booking.pricingMode,
      negotiate_expires_at: booking.negotiateExpiresAt ? booking.negotiateExpiresAt.toISOString() : null,
    };
    for (const runner of runners) {
      await this.realtime.broadcastIncomingRequest(runner.userId, payload).catch(() => undefined);
    }
  }

  // ── cancel ──
  async cancel(userId: string, bookingId: string, reason: string): Promise<Record<string, unknown>> {
    const booking = await this.getForCancel(userId, bookingId);
    const policy = CancellationPolicy.preview(booking);
    if (!policy.cancellable) throw new HttpException({ message: policy.reason }, HttpStatus.UNPROCESSABLE_ENTITY);

    await this.prisma.booking.update({
      where: { id: booking.id },
      data: {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelledBy: userId,
        cancellationReason: reason,
        cancellationFee: new Prisma.Decimal(policy.fee),
        tripShareToken: null,
        tripShareActive: false,
      },
    });

    if (booking.paymentStatus === 'paid') {
      const refundable = Math.round(Math.max(0, Number(booking.totalAmount) - policy.fee) * 100) / 100;
      if (refundable > 0) {
        await this.wallet.refund(booking.customerId, refundable, booking.id);
        const payment = await this.prisma.payment.findFirst({
          where: { bookingId: booking.id, status: 'completed' },
          orderBy: { createdAt: 'desc' },
        });
        if (payment) {
          await transitionPayment(this.prisma, payment, PaymentStatus.Refunded, {
            actor: userId,
            reason: 'Booking cancelled: refund to wallet minus fee',
            meta: { cancellation_fee: policy.fee, refunded_to: 'wallet' },
            extra: { refundAmount: new Prisma.Decimal(refundable), refundedAt: new Date() },
          });
        }
      }
      await this.prisma.booking.update({ where: { id: booking.id }, data: { paymentStatus: 'refunded' } });
    }

    await this.logStatusChange(booking.id, 'cancelled', userId, reason);
    const fresh = await this.prisma.booking.findUnique({ where: { id: booking.id } });
    if (fresh) this.events.emit(BookingEvents.Cancelled, { booking: fresh });

    const full = await this.prisma.booking.findUnique({ where: { id: booking.id }, include: { errandType: true, statusLogs: { orderBy: { createdAt: 'asc' } } } });
    return {
      data: full,
      policy,
      message:
        policy.fee > 0
          ? `Booking cancelled. A ₱${policy.fee.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} cancellation fee was applied.`
          : 'Booking cancelled successfully.',
    };
  }

  private async getForCancel(userId: string, bookingId: string): Promise<Booking> {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException({ message: 'Not found.' });
    // BookingPolicy::cancel — customer + status in [pending, matched, accepted].
    if (booking.customerId !== userId || !['pending', 'matched', 'accepted'].includes(booking.status)) {
      throw new HttpException({ message: 'This action is unauthorized.' }, HttpStatus.FORBIDDEN);
    }
    return booking;
  }

  cancelPreview(booking: Booking): CancellationPreview {
    return CancellationPolicy.preview(booking);
  }

  // ── rebook ──
  async rebook(userId: string, original: Booking): Promise<Booking> {
    const vehicleType = original.vehicleTypeRate ?? 'motorcycle';
    const pricing = await this.pricing.calculate(
      original.errandTypeId,
      Number(original.pickupLat),
      Number(original.pickupLng),
      original.dropoffLat !== null ? Number(original.dropoffLat) : null,
      original.dropoffLng !== null ? Number(original.dropoffLng) : null,
      vehicleType,
    );
    const newBooking = await this.prisma.booking.create({
      data: {
        bookingNumber: await this.generateBookingNumber(),
        customerId: userId,
        errandTypeId: original.errandTypeId,
        status: 'pending',
        pickupAddress: original.pickupAddress,
        pickupLat: original.pickupLat,
        pickupLng: original.pickupLng,
        pickupContactName: original.pickupContactName,
        pickupContactPhone: original.pickupContactPhone,
        dropoffAddress: original.dropoffAddress,
        dropoffLat: original.dropoffLat,
        dropoffLng: original.dropoffLng,
        dropoffContactName: original.dropoffContactName,
        dropoffContactPhone: original.dropoffContactPhone,
        description: original.description,
        specialInstructions: original.specialInstructions,
        estimatedItemValue: original.estimatedItemValue,
        scheduleType: 'now',
        pricingMode: original.pricingMode,
        vehicleTypeRate: vehicleType,
        distanceKm: new Prisma.Decimal(pricing.distance_km),
        baseFee: new Prisma.Decimal(pricing.base_fee),
        distanceFee: new Prisma.Decimal(pricing.distance_fee),
        serviceFee: new Prisma.Decimal(pricing.service_fee),
        surcharge: new Prisma.Decimal(pricing.surcharge),
        totalAmount: new Prisma.Decimal(pricing.total_amount),
        runnerPayout: new Prisma.Decimal(pricing.runner_payout),
        ridePin: original.isTransportation ? this.generateRidePin() : null,
        isTransportation: original.isTransportation,
      },
    });
    await this.logStatusChange(newBooking.id, 'pending', userId, `Rebooked from ${original.bookingNumber}`);
    await this.matchRunner(newBooking.id).catch(() => undefined);
    this.events.emit(BookingEvents.Created, { booking: newBooking });
    return this.prisma.booking.findUniqueOrThrow({ where: { id: newBooking.id }, include: { errandType: true, statusLogs: { orderBy: { createdAt: 'asc' } } } });
  }

  // ── retry match ──
  async retryMatch(userId: string, bookingId: string, widenStep: number): Promise<Record<string, unknown>> {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException({ message: 'Not found.' });
    // BookingPolicy::retryMatch
    const canRetry =
      booking.customerId === userId &&
      booking.runnerId === null &&
      (['no_runner', 'pending'].includes(booking.status) ||
        (booking.status === 'cancelled' && typeof booking.cancellationReason === 'string' && booking.cancellationReason.startsWith('Auto-cancelled')));
    if (!canRetry) throw new HttpException({ message: 'This action is unauthorized.' }, HttpStatus.FORBIDDEN);

    const step = widenStep || 1;
    const multiplier = step === 2 ? 1.75 : step === 3 ? 2.5 : 1.0;
    const baseRadius = Number((await this.config.getValue('matching_radius_km', '10')) ?? '10');
    const radius = baseRadius * multiplier;

    await this.prisma.booking.update({ where: { id: booking.id }, data: { status: 'pending', cancelledAt: null, cancellationReason: null } });
    await this.logStatusChange(booking.id, 'pending', userId, `Retry match (step ${step}, radius ${radius.toFixed(1)}km)`);
    await this.matchRunner(booking.id, radius).catch(() => undefined);

    const full = await this.prisma.booking.findUnique({ where: { id: booking.id }, include: { errandType: true, statusLogs: { orderBy: { createdAt: 'asc' } } } });
    return { data: full, meta: { radius_km: radius, widen_step: step }, message: 'Searching again with a wider radius.' };
  }

}
