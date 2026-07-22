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
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { SupportTicket, User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SanctumAuthGuard } from '../../common/auth/auth.guard';
import { ActiveGuard } from '../../common/auth/active.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { RouteThrottle } from '../../common/throttling/throttle.decorators';
import { LaravelValidationException } from '../../common/exceptions/validation.exception';
import { iso } from '../../common/serialization';
import { paginate, pageParams } from '../../common/pagination';
import type { AppConfig } from '../../config/configuration';
import { supportTicketResource, supportMessageResource } from './support.resource';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { SupportMessageDto } from './dto/support-message.dto';
import { ReportDto } from './dto/report.dto';

const SENDER_SELECT = { id: true, fullName: true, avatarUrl: true } as const;
// Mirrors the route constraint ->where('id', '[0-9a-fA-F-]{36}'): a non-matching
// id never reaches the handler in Laravel (route miss → 404).
const TICKET_ID_RE = /^[0-9a-fA-F-]{36}$/;

@Controller('support')
@UseGuards(SanctumAuthGuard, ActiveGuard)
export class SupportController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private path(): string {
    const app = this.config.get<AppConfig>('app')!;
    return `${app.url.replace(/\/+$/, '')}/${app.apiPrefix}/support/tickets`;
  }

  private async ticketOr404(id: string): Promise<SupportTicket> {
    if (!TICKET_ID_RE.test(id)) {
      throw new HttpException({ message: 'Not found.' }, HttpStatus.NOT_FOUND);
    }
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket) throw new HttpException({ message: 'Not found.' }, HttpStatus.NOT_FOUND);
    return ticket;
  }

  private authorizeOwner(user: User, ticket: SupportTicket): void {
    if (user.id !== ticket.userId) {
      throw new HttpException(
        { message: 'You do not have access to this support ticket.' },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  /** GET /support/tickets — the caller's own tickets, newest activity first. */
  @Get('tickets')
  async index(
    @CurrentUser() user: User,
    @Query() query: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const { page, perPage } = pageParams(query, 20);
    const offset = (page - 1) * perPage;

    const total = await this.prisma.supportTicket.count({ where: { userId: user.id } });

    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        user_id: string;
        booking_id: string | null;
        subject: string;
        category: string;
        status: string;
        last_message_at: Date | null;
        created_at: Date;
      }[]
    >(Prisma.sql`
      SELECT id, user_id, booking_id, subject, category, status, last_message_at, created_at
      FROM support_tickets
      WHERE user_id = ${user.id}::uuid
      ORDER BY COALESCE(last_message_at, created_at) DESC
      LIMIT ${perPage} OFFSET ${offset}
    `);

    const data = rows.map((r) =>
      supportTicketResource({
        id: r.id,
        userId: r.user_id,
        bookingId: r.booking_id,
        subject: r.subject,
        category: r.category,
        status: r.status,
        lastMessageAt: r.last_message_at,
        createdAt: r.created_at,
      }),
    );

    return paginate(data, total, page, perPage, this.path());
  }

  /**
   * POST /support/tickets — open a support ticket. Creates the ticket plus the
   * first 'user' message in a single transaction.
   */
  @Post('tickets')
  @HttpCode(HttpStatus.CREATED)
  @RouteThrottle(15, 1)
  async store(
    @CurrentUser() user: User,
    @Body() dto: CreateTicketDto,
  ): Promise<Record<string, unknown>> {
    if (dto.booking_id) {
      const owned = await this.prisma.booking.findFirst({
        where: {
          id: dto.booking_id,
          OR: [{ customerId: user.id }, { runnerId: user.id }],
        },
        select: { id: true },
      });
      if (!owned) {
        throw LaravelValidationException.field(
          'booking_id',
          'The selected booking does not belong to you.',
        );
      }
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const ticket = await tx.supportTicket.create({
        data: {
          userId: user.id,
          bookingId: dto.booking_id ?? null,
          subject: dto.subject,
          category: dto.category,
          status: 'open',
          lastMessageAt: now,
        },
      });

      await tx.supportMessage.create({
        data: {
          ticketId: ticket.id,
          senderId: user.id,
          senderType: 'user',
          content: dto.message,
        },
      });

      return ticket;
    });

    const full = await this.prisma.supportTicket.findUnique({
      where: { id: created.id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });

    return {
      data: supportTicketResource(full!),
      message: 'Support ticket created.',
    };
  }

  /**
   * GET /support/tickets/{id} — owner-only. Returns the ticket plus a
   * cursor-paginated page of messages (newest page fetched DESC, returned ASC,
   * ?before=<iso8601> cursor to page backwards into older messages).
   */
  @Get('tickets/:id')
  async show(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Query() query: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const ticket = await this.ticketOr404(id);
    this.authorizeOwner(user, ticket);

    const limit = Math.min(Math.max(parseInt(String(query.limit ?? '50'), 10) || 50, 1), 100);
    const before = query.before ? new Date(String(query.before)) : null;

    const rows = await this.prisma.supportMessage.findMany({
      where: {
        ticketId: ticket.id,
        ...(before && !Number.isNaN(before.getTime()) ? { createdAt: { lt: before } } : {}),
      },
      include: { sender: { select: SENDER_SELECT } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit).reverse(); // ASC for the client

    return {
      data: {
        ticket: supportTicketResource(ticket),
        messages: pageRows.map(supportMessageResource),
      },
      meta: {
        has_more: hasMore,
        next_before: hasMore && pageRows.length ? iso(pageRows[0].createdAt) : null,
      },
    };
  }

  /**
   * POST /support/tickets/{id}/messages — owner-only. Appends a 'user' message
   * and bumps last_message_at. A reply to a resolved/closed ticket re-opens it
   * to 'pending'.
   */
  @Post('tickets/:id/messages')
  @HttpCode(HttpStatus.CREATED)
  @RouteThrottle(60, 1)
  async postMessage(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: SupportMessageDto,
  ): Promise<Record<string, unknown>> {
    const ticket = await this.ticketOr404(id);
    this.authorizeOwner(user, ticket);

    const message = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const created = await tx.supportMessage.create({
        data: {
          ticketId: ticket.id,
          senderId: user.id,
          senderType: 'user',
          content: dto.content,
          imageUrl: dto.image_url ?? null,
        },
      });

      const status = ['resolved', 'closed'].includes(ticket.status) ? 'pending' : ticket.status;
      await tx.supportTicket.update({
        where: { id: ticket.id },
        data: { lastMessageAt: now, status },
      });

      return created;
    });

    const withSender = await this.prisma.supportMessage.findUnique({
      where: { id: message.id },
      include: { sender: { select: SENDER_SELECT } },
    });

    return { data: supportMessageResource(withSender!) };
  }

  /**
   * POST /support/report — legacy one-shot dispute intake (files a DisputeTicket).
   * Kept for backwards compatibility.
   */
  @Post('report')
  @HttpCode(HttpStatus.CREATED)
  async report(
    @CurrentUser() user: User,
    @Body() dto: ReportDto,
  ): Promise<Record<string, unknown>> {
    if (dto.booking_id) {
      const exists = await this.prisma.booking.findUnique({
        where: { id: dto.booking_id },
        select: { id: true },
      });
      if (!exists) {
        throw LaravelValidationException.field('booking_id', 'The selected booking id is invalid.');
      }
    }

    const ticket = await this.prisma.disputeTicket.create({
      data: {
        // Laravel writes `booking_id => $validated['booking_id'] ?? null`; the
        // column is NOT NULL, so a missing booking_id fails at the DB (as in Laravel).
        bookingId: (dto.booking_id ?? null) as string,
        reportedBy: user.id,
        category: dto.category,
        description: `[${dto.subject}] ${dto.description}`,
        status: 'open',
      },
    });

    // Mirrors Eloquent's freshly-created model serialization: only the
    // mass-assigned columns + id + timestamps (no evidence_urls/resolution/etc.).
    return {
      data: {
        booking_id: ticket.bookingId,
        reported_by: ticket.reportedBy,
        category: ticket.category,
        description: ticket.description,
        status: ticket.status,
        id: ticket.id,
        updated_at: iso(ticket.updatedAt),
        created_at: iso(ticket.createdAt),
      },
      message: 'Report submitted successfully.',
    };
  }
}
