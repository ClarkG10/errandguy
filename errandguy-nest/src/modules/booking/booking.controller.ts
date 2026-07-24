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
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import type { Booking, User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SanctumAuthGuard } from '../../common/auth/auth.guard';
import { ActiveGuard } from '../../common/auth/active.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { RouteThrottle } from '../../common/throttling/throttle.decorators';
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import { paginate, pageParams } from '../../common/pagination';
import { iso } from '../../common/serialization';
import type { AppConfig } from '../../config/configuration';
import type { UploadFile } from '../../integrations/supabase-storage.service';
import { BookingService } from './booking.service';
import { PricingService } from './pricing.service';
import { bookingResource, BOOKING_FULL_INCLUDE } from './booking.resource';
import { CreateBookingDto, EstimateDto, CancelBookingDto, RetryMatchDto } from './dto/booking.dto';

const LIST_INCLUDE = { errandType: true, runner: { include: { runnerProfile: true } }, reviews: { include: { reviewer: true } } } as const;

@Controller('bookings')
@UseGuards(SanctumAuthGuard, ActiveGuard, RolesGuard)
@Roles('customer')
export class BookingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly booking: BookingService,
    private readonly pricing: PricingService,
    private readonly config: ConfigService,
  ) {}

  private path(suffix = ''): string {
    const app = this.config.get<AppConfig>('app')!;
    return `${app.url.replace(/\/+$/, '')}/${app.apiPrefix}/bookings${suffix}`;
  }

  private assertParticipant(b: Booking, userId: string): void {
    if (b.customerId !== userId && b.runnerId !== userId) {
      throw new HttpException({ message: 'This action is unauthorized.' }, HttpStatus.FORBIDDEN);
    }
  }

  @Get()
  async index(@CurrentUser() user: User, @Query() query: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { page, perPage } = pageParams(query, 15);
    const where: Record<string, unknown> = { customerId: user.id };
    if (query.status) {
      const status = String(query.status);
      const completed = ['completed', 'delivered'];
      const cancelled = ['cancelled', 'no_runner', 'expired', 'rejected', 'failed'];
      if (status === 'active') where.status = { notIn: [...completed, ...cancelled] };
      else if (status === 'completed') where.status = { in: completed };
      else if (status === 'cancelled') where.status = { in: cancelled };
      else if (status !== 'all') where.status = status;
    }
    if (query.errand_type_id) where.errandTypeId = String(query.errand_type_id);
    if (query.date_from) where.createdAt = { gte: new Date(`${String(query.date_from)}T00:00:00`) };
    if (query.date_to) where.createdAt = { ...(where.createdAt as object), lte: new Date(`${String(query.date_to)}T23:59:59.999`) };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.booking.count({ where }),
      this.prisma.booking.findMany({ where, include: LIST_INCLUDE, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage }),
    ]);
    return paginate(rows.map((b) => bookingResource(b, user.id)), total, page, perPage, this.path());
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RouteThrottle(15, 1)
  @Idempotent(201)
  @UseInterceptors(FilesInterceptor('item_photos', 5))
  async store(
    @CurrentUser() user: User,
    @Body() dto: CreateBookingDto,
    @UploadedFiles() files?: { buffer: Buffer; mimetype: string; originalname: string }[],
  ): Promise<Record<string, unknown>> {
    const photos: UploadFile[] = (files ?? []).map((f) => ({ buffer: f.buffer, mimetype: f.mimetype, originalname: f.originalname }));
    const { data, checkoutUrl, paymentId } = await this.booking.create(user, dto, photos);
    return {
      data: bookingResource(data, user.id),
      checkout_url: checkoutUrl,
      payment_id: paymentId,
      message: 'Booking created successfully.',
    };
  }

  @Get('active')
  async active(@CurrentUser() user: User): Promise<{ data: unknown }> {
    const b = await this.prisma.booking.findFirst({
      where: { customerId: user.id, status: { notIn: ['completed', 'cancelled'] } },
      include: BOOKING_FULL_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return { data: b ? bookingResource(b, user.id) : null };
  }

  @Post('estimate')
  @HttpCode(HttpStatus.OK)
  async estimate(@Body() dto: EstimateDto): Promise<{ data: unknown }> {
    const estimates = await this.pricing.estimate(
      dto.errand_type_id,
      dto.pickup_lat,
      dto.pickup_lng,
      dto.dropoff_lat ?? null,
      dto.dropoff_lng ?? null,
    );
    return { data: estimates };
  }

  @Get(':id')
  async show(@CurrentUser() user: User, @Param('id') id: string): Promise<{ data: unknown }> {
    const b = await this.prisma.booking.findUnique({ where: { id }, include: BOOKING_FULL_INCLUDE });
    if (!b) throw new HttpException({ message: 'Not found.' }, HttpStatus.NOT_FOUND);
    this.assertParticipant(b, user.id);
    return { data: bookingResource(b, user.id) };
  }

  @Get(':id/cancel-preview')
  async cancelPreview(@CurrentUser() user: User, @Param('id') id: string): Promise<{ data: unknown }> {
    const b = await this.prisma.booking.findUnique({ where: { id } });
    if (!b) throw new HttpException({ message: 'Not found.' }, HttpStatus.NOT_FOUND);
    if (b.customerId !== user.id || !['pending', 'matched', 'accepted'].includes(b.status)) {
      throw new HttpException({ message: 'This action is unauthorized.' }, HttpStatus.FORBIDDEN);
    }
    return { data: this.booking.cancelPreview(b) };
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: CancelBookingDto): Promise<Record<string, unknown>> {
    const result = await this.booking.cancel(user.id, id, dto.reason);
    return {
      data: bookingResource(result.data as Booking, user.id),
      cancellation: result.policy,
      message: result.message,
    };
  }

  @Get(':id/track')
  async track(@CurrentUser() user: User, @Param('id') id: string): Promise<{ data: unknown }> {
    const b = await this.prisma.booking.findUnique({ where: { id }, include: BOOKING_FULL_INCLUDE });
    if (!b) throw new HttpException({ message: 'Not found.' }, HttpStatus.NOT_FOUND);
    this.assertParticipant(b, user.id);
    let runnerLocation: Record<string, unknown> | null = null;
    if (b.runnerId) {
      const loc = await this.prisma.runnerLocation.findFirst({
        where: { bookingId: b.id, runnerId: b.runnerId },
        orderBy: { createdAt: 'desc' },
      });
      if (loc) {
        runnerLocation = {
          lat: loc.lat,
          lng: loc.lng,
          heading: loc.heading,
          speed: loc.speed,
          updated_at: iso(loc.createdAt),
        };
      }
    }
    return { data: { booking: bookingResource(b, user.id), runner_location: runnerLocation } };
  }

  @Post(':id/rebook')
  @HttpCode(HttpStatus.CREATED)
  async rebook(@CurrentUser() user: User, @Param('id') id: string): Promise<Record<string, unknown>> {
    const original = await this.prisma.booking.findUnique({ where: { id } });
    if (!original) throw new HttpException({ message: 'Not found.' }, HttpStatus.NOT_FOUND);
    this.assertParticipant(original, user.id);
    const created = await this.booking.rebook(user.id, original);
    return { data: bookingResource(created, user.id), message: 'Booking rebooked successfully.' };
  }

  @Post(':id/retry-match')
  @HttpCode(HttpStatus.OK)
  @RouteThrottle(6, 1)
  async retryMatch(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: RetryMatchDto): Promise<Record<string, unknown>> {
    const result = await this.booking.retryMatch(user.id, id, dto.widen_step ?? 1);
    return {
      data: bookingResource(result.data as Booking, user.id),
      meta: result.meta,
      message: result.message,
    };
  }
}
