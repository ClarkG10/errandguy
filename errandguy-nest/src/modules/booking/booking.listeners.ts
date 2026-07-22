import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../../messaging/notification.service';
import { ReferralService } from '../referral/referral.service';
import {
  BookingCancelledPayload,
  BookingCreatedPayload,
  BookingEvents,
  BookingStatusChangedPayload,
  RideDurationAlertPayload,
  RouteDeviationAlertPayload,
} from './booking.events';

const STATUS_TEMPLATES: Record<string, { customer?: { title: string; body: string }; runner?: { title: string; body: string } }> = {
  matched: { customer: { title: 'Runner Found!', body: 'A runner has been matched for booking #{number}.' } },
  accepted: { customer: { title: 'Runner Assigned!', body: 'Your runner is heading to the pickup location.' } },
  arrived_at_pickup: { customer: { title: 'Runner Arrived', body: 'Your runner has arrived at the pickup location.' } },
  picked_up: { customer: { title: 'Item Picked Up', body: 'Your item has been picked up and is on the way.' } },
  completed: {
    customer: { title: 'Errand Completed!', body: 'Your errand #{number} has been completed.' },
    runner: { title: 'Errand Completed', body: 'Errand #{number} completed. Payment will be processed.' },
  },
  cancelled: {
    customer: { title: 'Booking Cancelled', body: 'Booking #{number} has been cancelled.' },
    runner: { title: 'Booking Cancelled', body: 'Booking #{number} was cancelled by the customer.' },
  },
};

/** Port of the booking event listeners (SendBooking*Notification, RewardReferralOnFirstBooking, SendSafetyAlertNotification). */
@Injectable()
export class BookingListeners {
  private readonly logger = new Logger('BookingListeners');

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly referral: ReferralService,
  ) {}

  @OnEvent(BookingEvents.Created)
  async onCreated({ booking }: BookingCreatedPayload): Promise<void> {
    const number = booking.bookingNumber ?? booking.id;
    await this.notifications.sendPush(
      booking.customerId,
      'Booking Confirmed',
      `Your errand #${number} has been placed. Looking for a runner...`,
      { type: 'booking_update', booking_id: booking.id, status: 'pending' },
    );
  }

  @OnEvent(BookingEvents.StatusChanged)
  async onStatusChanged({ booking, newStatus }: BookingStatusChangedPayload): Promise<void> {
    await this.sendStatusNotification(booking, newStatus);
    await this.rewardReferral(booking, newStatus);
  }

  private async sendStatusNotification(booking: { id: string; bookingNumber: string | null; customerId: string; runnerId: string | null }, newStatus: string): Promise<void> {
    const templates = STATUS_TEMPLATES[newStatus];
    if (!templates) return;
    const number = booking.bookingNumber ?? booking.id;
    if (templates.customer && booking.customerId) {
      await this.notifications.sendPush(
        booking.customerId,
        templates.customer.title,
        templates.customer.body.replace('{number}', number),
        { type: 'booking_update', booking_id: booking.id, status: newStatus },
      );
    }
    if (templates.runner && booking.runnerId) {
      await this.notifications.sendPush(
        booking.runnerId,
        templates.runner.title,
        templates.runner.body.replace('{number}', number),
        { type: 'booking_update', booking_id: booking.id, status: newStatus },
      );
    }
  }

  /** RewardReferralOnFirstBooking — idempotent reward on first completed booking. */
  private async rewardReferral(booking: { customerId: string }, newStatus: string): Promise<void> {
    if (newStatus !== 'completed' || !booking.customerId) return;
    const pending = await this.prisma.referral.findFirst({
      where: { refereeId: booking.customerId, status: { not: 'rewarded' } },
      select: { id: true },
    });
    if (!pending) return;
    const completedCount = await this.prisma.booking.count({
      where: { customerId: booking.customerId, status: 'completed' },
    });
    if (completedCount < 1) return;
    await this.referral.reward(booking.customerId);
  }

  @OnEvent(BookingEvents.Cancelled)
  async onCancelled({ booking }: BookingCancelledPayload): Promise<void> {
    const number = booking.bookingNumber ?? booking.id;
    if (booking.customerId) {
      await this.notifications.sendPush(
        booking.customerId,
        'Booking Cancelled',
        `Your errand #${number} has been cancelled.`,
        { type: 'booking_update', booking_id: booking.id, status: 'cancelled' },
      );
    }
    if (booking.runnerId) {
      await this.notifications.sendPush(
        booking.runnerId,
        'Booking Cancelled',
        `Errand #${number} has been cancelled by the customer.`,
        { type: 'booking_update', booking_id: booking.id, status: 'cancelled' },
      );
    }
  }

  @OnEvent(BookingEvents.RideDurationAlert)
  async onDurationAlert({ booking, elapsedMinutes, estimatedMinutes }: RideDurationAlertPayload): Promise<void> {
    this.logger.warn(`Safety: booking ${booking.id} exceeded duration (${elapsedMinutes}min vs ${estimatedMinutes}min)`);
    await this.notifyTrustedContacts(
      booking.customerId,
      'Duration Alert',
      `An errand for your contact is taking longer than expected (${elapsedMinutes} min vs ${estimatedMinutes} min estimated).`,
    );
  }

  @OnEvent(BookingEvents.RouteDeviationAlert)
  async onRouteDeviation({ booking, deviationMeters }: RouteDeviationAlertPayload): Promise<void> {
    const km = Math.round((deviationMeters / 1000) * 100) / 100;
    this.logger.warn(`Safety: booking ${booking.id} route deviation ${km}km`);
    await this.notifyTrustedContacts(
      booking.customerId,
      'Route Deviation Alert',
      `An errand for your contact has deviated ${km}km from the expected route.`,
    );
  }

  private async notifyTrustedContacts(customerId: string, title: string, body: string): Promise<void> {
    const contacts = await this.prisma.trustedContact.findMany({ where: { userId: customerId } });
    for (const contact of contacts) {
      if (contact.phone) this.logger.log(`Safety SMS to ${contact.phone}: [${title}] ${body}`);
    }
  }
}
