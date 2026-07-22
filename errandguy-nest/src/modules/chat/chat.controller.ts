import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Prisma } from '@prisma/client';
import type { Booking, User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SupabaseStorageService, UploadFile } from '../../integrations/supabase-storage.service';
import { SanctumAuthGuard } from '../../common/auth/auth.guard';
import { ActiveGuard } from '../../common/auth/active.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { RouteThrottle } from '../../common/throttling/throttle.decorators';
import { iso } from '../../common/serialization';
import { messageResource } from './message.resource';
import { SendMessageDto } from './dto/send-message.dto';

const CLOSED = ['completed', 'cancelled', 'no_runner'];
const SENDER_SELECT = { id: true, fullName: true, avatarUrl: true };

@Controller('chat')
@UseGuards(SanctumAuthGuard, ActiveGuard)
export class ChatController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: SupabaseStorageService,
  ) {}

  private async bookingOr404(bookingId: string): Promise<Booking> {
    const b = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!b) throw new HttpException({ message: 'Not found.' }, HttpStatus.NOT_FOUND);
    return b;
  }

  private assertParticipant(user: User, booking: Booking): void {
    if (user.id !== booking.customerId && user.id !== booking.runnerId) {
      throw new HttpException(
        { message: 'You are not a participant of this booking.' },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: User): Promise<Record<string, unknown>> {
    const bookings = await this.prisma.booking.findMany({
      where: {
        OR: [{ customerId: user.id }, { runnerId: user.id }],
        status: { notIn: CLOSED },
      },
      select: { id: true },
    });
    if (!bookings.length) return { data: { total: 0, by_booking: {} } };

    const grouped = await this.prisma.message.groupBy({
      by: ['bookingId'],
      where: {
        bookingId: { in: bookings.map((b) => b.id) },
        senderId: { not: user.id },
        readAt: null,
      },
      _count: { _all: true },
    });
    const byBooking: Record<string, number> = {};
    let total = 0;
    for (const g of grouped) {
      byBooking[g.bookingId] = g._count._all;
      total += g._count._all;
    }
    return { data: { total, by_booking: byBooking } };
  }

  @Get('conversations')
  async conversations(@CurrentUser() user: User): Promise<Record<string, unknown>> {
    const bookings = await this.prisma.booking.findMany({
      where: { OR: [{ customerId: user.id }, { runnerId: user.id }] },
      include: {
        customer: { select: SENDER_SELECT },
        runner: { select: SENDER_SELECT },
        errandType: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 60,
    });
    if (!bookings.length) return { data: [] };

    const ids = bookings.map((b) => b.id);
    const latestRows = await this.prisma.$queryRaw<
      {
        booking_id: string;
        content: string | null;
        image_url: string | null;
        is_system: boolean;
        sender_id: string;
        created_at: Date;
      }[]
    >(Prisma.sql`
      SELECT DISTINCT ON (booking_id) booking_id, content, image_url, is_system, sender_id, created_at
      FROM messages
      WHERE booking_id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
      ORDER BY booking_id, created_at DESC
    `);
    const latest = new Map(latestRows.map((r) => [r.booking_id, r]));

    const unreadGrouped = await this.prisma.message.groupBy({
      by: ['bookingId'],
      where: { bookingId: { in: ids }, senderId: { not: user.id }, readAt: null },
      _count: { _all: true },
    });
    const unread = new Map(unreadGrouped.map((g) => [g.bookingId, g._count._all]));

    const cutoff = Date.now() - 14 * 86_400_000;

    const items = bookings
      .map((b) => {
        const last = latest.get(b.id);
        const hasRecent = last && new Date(last.created_at).getTime() >= cutoff;
        if (CLOSED.includes(b.status) && !hasRecent) return null;

        const isCustomer = user.id === b.customerId;
        const other = isCustomer ? b.runner : b.customer;
        let preview: string | null = null;
        if (last) preview = last.image_url && !last.is_system ? '📷 Photo' : last.content;

        return {
          booking_id: b.id,
          booking_number: b.bookingNumber,
          status: b.status,
          errand_type: b.errandType ? { id: b.errandType.id, name: b.errandType.name } : null,
          counterparty: other
            ? { id: other.id, full_name: other.fullName, avatar_url: other.avatarUrl }
            : null,
          last_message: last
            ? {
                preview,
                is_image: !!last.image_url,
                is_system: !!last.is_system,
                is_outgoing: last.sender_id === user.id,
                created_at: iso(last.created_at),
              }
            : null,
          unread_count: unread.get(b.id) ?? 0,
          sort_ts: last ? new Date(last.created_at).getTime() : new Date(b.updatedAt).getTime(),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.sort_ts - a.sort_ts)
      .map(({ sort_ts, ...rest }) => rest);

    return { data: items };
  }

  @Get(':bookingId/messages')
  async index(
    @CurrentUser() user: User,
    @Param('bookingId') bookingId: string,
    @Query() query: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const booking = await this.bookingOr404(bookingId);
    this.assertParticipant(user, booking);

    const limit = Math.min(Math.max(parseInt(String(query.limit ?? '50'), 10) || 50, 1), 100);
    const before = query.before ? new Date(String(query.before)) : null;

    const rows = await this.prisma.message.findMany({
      where: {
        bookingId,
        ...(before && !Number.isNaN(before.getTime()) ? { createdAt: { lt: before } } : {}),
      },
      include: { sender: { select: SENDER_SELECT } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).reverse();
    return {
      data: page.map(messageResource),
      meta: {
        has_more: hasMore,
        next_before: hasMore && page.length ? iso(page[0].createdAt) : null,
      },
    };
  }

  @Post(':bookingId/messages')
  @HttpCode(HttpStatus.CREATED)
  @RouteThrottle(60, 1)
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async store(
    @CurrentUser() user: User,
    @Param('bookingId') bookingId: string,
    @Body() dto: SendMessageDto,
    @UploadedFile() image?: { buffer: Buffer; mimetype: string; originalname: string },
  ): Promise<Record<string, unknown>> {
    const booking = await this.bookingOr404(bookingId);
    this.assertParticipant(user, booking);

    if (['completed', 'cancelled'].includes(booking.status)) {
      throw new HttpException(
        { message: 'Cannot send messages on a closed booking.' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (!dto.content && !dto.image_url && !image) {
      throw new HttpException(
        { message: 'Either content or an image must be provided.', errors: { content: ['Either content or an image must be provided.'] } },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    let imageUrl = dto.image_url ?? null;
    if (image) {
      const uf: UploadFile = { buffer: image.buffer, mimetype: image.mimetype, originalname: image.originalname };
      imageUrl = await this.storage.uploadChatImage(bookingId, uf);
    }

    const message = await this.prisma.message.create({
      data: {
        bookingId,
        senderId: user.id,
        content: dto.content ?? null,
        imageUrl,
        isSystem: false,
      },
    });
    const withSender = await this.prisma.message.findUnique({
      where: { id: message.id },
      include: { sender: { select: SENDER_SELECT } },
    });
    return { data: messageResource(withSender!) };
  }

  @Post(':bookingId/read')
  @HttpCode(HttpStatus.OK)
  async markAsRead(
    @CurrentUser() user: User,
    @Param('bookingId') bookingId: string,
  ): Promise<{ message: string }> {
    const booking = await this.bookingOr404(bookingId);
    this.assertParticipant(user, booking);
    await this.prisma.message.updateMany({
      where: { bookingId, senderId: { not: user.id }, readAt: null },
      data: { readAt: new Date() },
    });
    return { message: 'Messages marked as read.' };
  }
}
