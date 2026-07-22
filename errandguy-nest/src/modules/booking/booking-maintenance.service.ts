import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../cache/cache.service';
import { SystemConfigService } from '../payment/system-config.service';
import { LocationService } from './location.service';
import { BookingEvents } from './booking.events';
import type { QueueConfig } from '../../config/configuration';

/**
 * Reconciliation sweeps that replace Laravel's delayed jobs (AutoCancel,
 * ExpireNegotiate, CheckRideDuration) and the CleanupLocations command.
 * Domain-state driven, so they survive restarts (unlike lost delayed jobs).
 */
@Injectable()
export class BookingMaintenanceService {
  private readonly logger = new Logger('BookingMaintenance');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly appConfig: ConfigService,
    private readonly cache: CacheService,
    private readonly location: LocationService,
    private readonly events: EventEmitter2,
  ) {}

  private enabled(): boolean {
    return this.appConfig.get<QueueConfig>('queue')!.schedulerEnabled;
  }

  /** AutoCancelBookingJob: cancel pending/no_runner bookings past the timeout. */
  @Cron(CronExpression.EVERY_MINUTE)
  async autoCancelSweep(): Promise<void> {
    if (!this.enabled()) return;
    const timeout = Number((await this.config.getValue('auto_cancel_timeout_minutes', '30')) ?? '30');
    const cutoff = new Date(Date.now() - timeout * 60 * 1000);
    const stale = await this.prisma.booking.findMany({
      where: { status: { in: ['pending', 'no_runner'] }, createdAt: { lt: cutoff } },
      select: { id: true },
    });
    for (const b of stale) {
      await this.prisma.booking.update({
        where: { id: b.id },
        data: { status: 'cancelled', cancelledAt: new Date(), cancellationReason: 'Auto-cancelled: no runner found within timeout.' },
      });
      await this.prisma.bookingStatusLog.create({
        data: { bookingId: b.id, status: 'cancelled', changedBy: null, note: `Auto-cancelled after ${timeout} minutes with no runner` },
      });
    }
    if (stale.length) this.logger.log(`Auto-cancelled ${stale.length} stale bookings`);
  }

  /** ExpireNegotiateBookingJob: expire un-accepted negotiate bookings. */
  @Cron(CronExpression.EVERY_MINUTE)
  async expireNegotiateSweep(): Promise<void> {
    if (!this.enabled()) return;
    const expired = await this.prisma.booking.findMany({
      where: {
        pricingMode: 'negotiate',
        status: 'pending',
        runnerId: null,
        negotiateExpiresAt: { lt: new Date() },
      },
      select: { id: true },
    });
    for (const b of expired) {
      await this.prisma.booking.update({
        where: { id: b.id },
        data: { status: 'cancelled', cancelledAt: new Date(), cancellationReason: 'Negotiation period expired with no runner acceptance.' },
      });
      await this.prisma.bookingStatusLog.create({
        data: { bookingId: b.id, status: 'cancelled', changedBy: null, note: 'Negotiate mode expired' },
      });
    }
    if (expired.length) this.logger.log(`Expired ${expired.length} negotiate bookings`);
  }

  /** CheckRideDurationJob: alert on transportation rides exceeding expected duration. */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async checkRideDuration(): Promise<void> {
    if (!this.enabled()) return;
    const multiplier = Number((await this.config.getValue('ride_duration_alert_multiplier', '2.0')) ?? '2.0');
    const bookings = await this.prisma.booking.findMany({
      where: { isTransportation: true, status: 'in_transit', pickedUpAt: { not: null }, sosTriggered: false },
    });
    for (const booking of bookings) {
      const elapsedMinutes = Math.floor((Date.now() - booking.pickedUpAt!.getTime()) / 60000);
      const distanceKm = Number(booking.distanceKm ?? 5);
      const estimatedMinutes = Math.max(5, distanceKm * 3);
      const threshold = estimatedMinutes * multiplier;
      if (elapsedMinutes > threshold) {
        const cacheKey = `ride_duration_alert:${booking.id}`;
        if (this.cache.get(cacheKey) !== undefined) continue;
        this.logger.warn(`Ride duration alert for booking ${booking.id}: ${elapsedMinutes}min vs threshold ${threshold}min`);
        this.events.emit(BookingEvents.RideDurationAlert, { booking, elapsedMinutes, estimatedMinutes: Math.floor(estimatedMinutes) });
        this.cache.put(cacheKey, true, 1800);
      }
    }
  }

  /** CleanupLocationsCommand: purge runner_locations older than 24h. */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanupLocations(): Promise<void> {
    if (!this.enabled()) return;
    await this.location.cleanupOldLocations();
  }
}
