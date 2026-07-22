import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SosAlert, TrustedContact } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../../messaging/notification.service';
import { RealtimeService } from '../../messaging/realtime.service';
import type { AppConfig } from '../../config/configuration';
import { strRandom } from './str-random';

/**
 * Port of SOSService. Creates a SosAlert, flips `booking.sos_triggered`, notifies
 * the triggerer's trusted contacts + the counterparty (via RealtimeService) and
 * an admin safety topic (via NotificationService), and mints a 60-minute
 * live-link token.
 */
@Injectable()
export class SOSService {
  private readonly logger = new Logger('SOS');

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly realtime: RealtimeService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Trigger an SOS alert for a booking.
   *
   * @param bookingId
   * @param triggeredBy user-id of the person pulling the alarm
   * @param role        'customer' or 'runner'
   */
  async triggerSOS(bookingId: string, triggeredBy: string, role = 'customer'): Promise<SosAlert> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { runner: { include: { runnerProfile: true } } },
    });
    if (!booking) throw new HttpException({ message: 'Not found.' }, HttpStatus.NOT_FOUND);

    const runnerProfile = booking.runner?.runnerProfile ?? null;

    // Idempotency — if there's already an active alert for this booking,
    // return it instead of stacking duplicates.
    const existing = await this.prisma.sosAlert.findFirst({
      where: { bookingId, status: 'active' },
      orderBy: { triggeredAt: 'desc' },
    });
    if (existing) return existing;

    let alert = await this.prisma.sosAlert.create({
      data: {
        bookingId,
        customerId: booking.customerId,
        runnerId: booking.runnerId,
        triggeredBy,
        triggeredByRole: role,
        triggeredAt: new Date(),
        customerLat: booking.dropoffLat,
        customerLng: booking.dropoffLng,
        runnerLat: runnerProfile?.currentLat ?? null,
        runnerLng: runnerProfile?.currentLng ?? null,
        liveLinkToken: strRandom(64),
        liveLinkExpiresAt: new Date(Date.now() + 60 * 60_000),
        status: 'active',
      },
    });

    // Notify the trusted contacts of whoever triggered the alarm.
    const contacts = await this.prisma.trustedContact.findMany({
      where: { userId: triggeredBy },
      orderBy: { createdAt: 'asc' },
    });

    const contactIds = contacts.map((c) => c.id);
    alert = await this.prisma.sosAlert.update({
      where: { id: alert.id },
      data: { contactsNotified: contactIds },
    });

    const app = this.config.get<AppConfig>('app')!;
    const liveLink = `${app.url}/trip/${alert.liveLinkToken}`;

    for (const contact of contacts) {
      this.notifySMSContact(contact, triggeredBy, liveLink, booking.id);
    }

    await this.prisma.booking.update({
      where: { id: bookingId },
      data: { sosTriggered: true },
    });

    await this.realtime.broadcastSOSAlert(bookingId, triggeredBy, {
      alert_id: alert.id,
      status: 'active',
      live_link: liveLink,
      triggered_by_role: role,
    });

    await this.notifications.sendToTopic(
      'admin_safety',
      '🚨 SOS Alert',
      `Emergency triggered by ${role} for booking #${booking.bookingNumber}`,
      {
        type: 'sos',
        booking_id: bookingId,
        alert_id: alert.id,
        triggered_by_role: role,
      },
    );

    return alert;
  }

  async deactivateSOS(bookingId: string): Promise<void> {
    const alert = await this.prisma.sosAlert.findFirst({
      where: { bookingId, status: 'active' },
      orderBy: { triggeredAt: 'desc' },
    });

    if (!alert) return;

    await this.prisma.sosAlert.update({
      where: { id: alert.id },
      data: { status: 'resolved', resolvedAt: new Date() },
    });

    await this.prisma.booking.updateMany({
      where: { id: bookingId },
      data: { sosTriggered: false },
    });

    await this.realtime.broadcastSOSAlert(bookingId, alert.customerId, {
      alert_id: alert.id,
    });
  }

  private notifySMSContact(
    contact: TrustedContact,
    userId: string,
    liveLink: string,
    bookingId: string,
  ): void {
    this.logger.log(
      `SOS SMS notification ${JSON.stringify({
        contact_name: contact.name,
        contact_phone: contact.phone,
        live_link: liveLink,
        booking_id: bookingId,
      })}`,
    );
  }
}
