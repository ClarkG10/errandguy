import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import type { IntegrationsConfig } from '../config/configuration';

/**
 * Port of RealtimeService. Writes rows to Supabase over PostgREST so the mobile
 * app's realtime subscriptions on `notifications`, `runner_locations`, and
 * `messages` fire exactly as before. All writes are best-effort (log on
 * failure, never throw). `data` is JSON-encoded into the field to match the
 * original payload byte-for-byte.
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger('Realtime');

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  private get supa(): { url: string; serviceKey: string } {
    return this.config.get<IntegrationsConfig>('integrations')!.supabase;
  }

  private headers(): Record<string, string> {
    const { serviceKey } = this.supa;
    return {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    };
  }

  private async post(table: string, row: Record<string, unknown>): Promise<void> {
    const { url } = this.supa;
    if (!url) return;
    try {
      await axios.post(`${url}/rest/v1/${table}`, row, { headers: this.headers(), timeout: 10_000 });
    } catch (e) {
      this.logger.error(`Failed to write ${table}: ${(e as Error).message}`);
    }
  }

  async broadcastBookingUpdate(bookingId: string, status: string, extra: Record<string, unknown> = {}): Promise<void> {
    const customerId = await this.getBookingCustomerId(bookingId);
    await this.insertNotification(
      customerId,
      'Booking Update',
      `Your booking status changed to ${status}.`,
      'booking_update',
      { booking_id: bookingId, status, ...extra },
    );
  }

  async broadcastIncomingRequest(runnerId: string, bookingData: Record<string, unknown>): Promise<void> {
    await this.insertNotification(
      runnerId,
      'New Errand Request',
      'A new errand is available near you.',
      'booking_update',
      bookingData,
    );
  }

  async broadcastSOSAlert(bookingId: string, userId: string, location: Record<string, unknown>): Promise<void> {
    const counterpart = await this.getBookingCounterpartId(bookingId, userId);
    await this.insertNotification(counterpart, 'SOS Alert', 'An emergency alert has been triggered.', 'sos', {
      booking_id: bookingId,
      ...location,
    });
  }

  async insertNotification(
    userId: string,
    title: string,
    body: string,
    type: string,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    if (!userId) return;
    await this.post('notifications', {
      user_id: userId,
      title,
      body,
      type,
      data: JSON.stringify(data),
      is_read: false,
    });
  }

  async broadcastRunnerLocation(
    bookingId: string,
    runnerId: string,
    coords: { lat: number; lng: number; heading?: number; speed?: number; accuracy?: number },
  ): Promise<void> {
    await this.post('runner_locations', {
      booking_id: bookingId,
      runner_id: runnerId,
      lat: coords.lat,
      lng: coords.lng,
      heading: coords.heading ?? null,
      speed: coords.speed ?? null,
      accuracy: coords.accuracy ?? null,
    });
  }

  async broadcastChatMessage(
    bookingId: string,
    senderId: string,
    messageData: { content?: string | null; image_url?: string | null; is_system?: boolean },
  ): Promise<void> {
    await this.post('messages', {
      booking_id: bookingId,
      sender_id: senderId,
      content: messageData.content ?? null,
      image_url: messageData.image_url ?? null,
      is_system: messageData.is_system ?? false,
    });
  }

  private async getBookingCustomerId(bookingId: string): Promise<string> {
    const b = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: { customerId: true },
    });
    return b?.customerId ?? '';
  }

  private async getBookingCounterpartId(bookingId: string, currentUserId: string): Promise<string> {
    const b = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: { customerId: true, runnerId: true },
    });
    if (!b) return '';
    return currentUserId === b.customerId ? (b.runnerId ?? '') : b.customerId;
  }
}
