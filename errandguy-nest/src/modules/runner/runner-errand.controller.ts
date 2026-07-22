import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SanctumAuthGuard } from '../../common/auth/auth.guard';
import { ActiveGuard } from '../../common/auth/active.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { asArray } from '../../common/serialization';
import { bookingResource } from '../booking/booking.resource';
import { RunnerService, StatusRequestFiles, MultipartFile } from './runner.service';

const ERRAND_INCLUDE = {
  errandType: true,
  customer: true,
  statusLogs: { orderBy: { createdAt: 'asc' } },
} as const;

const R_KM = 6371;
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (d: number): number => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const STATUS_FILE_FIELDS = [
  { name: 'pickup_photo', maxCount: 1 },
  { name: 'receipt_photo', maxCount: 1 },
  { name: 'delivery_photo', maxCount: 1 },
  { name: 'signature', maxCount: 1 },
];

type UploadedFieldFiles = Record<string, MultipartFile[] | undefined>;

@Controller('runner')
@UseGuards(SanctumAuthGuard, ActiveGuard, RolesGuard)
@Roles('runner')
export class RunnerErrandController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: RunnerService,
  ) {}

  @Get('errand/current')
  async current(@CurrentUser() user: User): Promise<{ data: unknown }> {
    const booking = await this.prisma.booking.findFirst({
      where: { runnerId: user.id, status: { notIn: ['completed', 'cancelled'] } },
      include: ERRAND_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return { data: booking ? bookingResource(booking, user.id) : null };
  }

  @Get('errand/available')
  async available(@CurrentUser() user: User): Promise<{ data: unknown[] }> {
    const profile = await this.prisma.runnerProfile.findUnique({ where: { userId: user.id } });
    if (!profile || !profile.isOnline) return { data: [] };

    const bookings = await this.prisma.booking.findMany({
      where: {
        status: 'pending',
        pricingMode: 'negotiate',
        negotiateExpiresAt: { gt: new Date() },
        runnerId: null,
      },
      include: { errandType: true, customer: true },
      orderBy: { createdAt: 'desc' },
    });

    const preferredTypes = asArray<string>(profile.preferredTypes);
    const filtered = bookings.filter((booking) => {
      if (preferredTypes.length) {
        const slug = booking.errandType?.slug;
        if (!slug || !preferredTypes.includes(slug)) return false;
      }
      if (profile.currentLat != null && profile.currentLng != null && booking.pickupLat != null && booking.pickupLng != null) {
        const distance = haversine(
          Number(profile.currentLat),
          Number(profile.currentLng),
          Number(booking.pickupLat),
          Number(booking.pickupLng),
        );
        const maxRadius = profile.workingAreaRadius ? Number(profile.workingAreaRadius) / 1000 : 10.0;
        return distance <= maxRadius;
      }
      return true;
    });

    // Non-participant broadcast view: never expose the customer's phone.
    const data = filtered.map((booking) => {
      if (booking.customer) booking.customer.phone = null;
      return bookingResource(booking, user.id);
    });
    return { data };
  }

  @Get('errand/:id')
  async show(@CurrentUser() user: User, @Param('id') id: string): Promise<{ data: unknown }> {
    const booking = await this.prisma.booking.findFirst({
      where: { id, runnerId: user.id },
      include: ERRAND_INCLUDE,
    });
    if (!booking) throw new HttpException({ message: 'Errand not found' }, HttpStatus.NOT_FOUND);
    return { data: bookingResource(booking, user.id) };
  }

  @Post('errand/:id/accept')
  @HttpCode(HttpStatus.OK)
  async accept(@CurrentUser() user: User, @Param('id') id: string): Promise<Record<string, unknown>> {
    const booking = await this.runner.acceptErrand(user, id);
    return { data: bookingResource(booking, user.id), message: 'Errand accepted.' };
  }

  @Post('errand/:id/decline')
  @HttpCode(HttpStatus.OK)
  async decline(@CurrentUser() user: User, @Param('id') id: string): Promise<{ message: string }> {
    await this.runner.declineErrand(user, id);
    return { message: 'Errand declined.' };
  }

  @Post('errand/:id/status')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileFieldsInterceptor(STATUS_FILE_FIELDS, { limits: { fileSize: 12 * 1024 * 1024 } }))
  async updateStatus(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @UploadedFiles() uploaded?: UploadedFieldFiles,
  ): Promise<Record<string, unknown>> {
    const files: StatusRequestFiles = {
      pickup_photo: uploaded?.pickup_photo?.[0],
      receipt_photo: uploaded?.receipt_photo?.[0],
      delivery_photo: uploaded?.delivery_photo?.[0],
      signature: uploaded?.signature?.[0],
    };
    const booking = await this.runner.updateErrandStatus(
      user,
      id,
      {
        status: body.status !== undefined ? String(body.status) : undefined,
        note: this.str(body.note),
        lat: this.num(body.lat),
        lng: this.num(body.lng),
        actual_item_cost: this.num(body.actual_item_cost),
      },
      files,
    );
    return { data: bookingResource(booking, user.id), message: 'Status updated.' };
  }

  @Post('errand/:id/verify-pin')
  @HttpCode(HttpStatus.OK)
  async verifyPin(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body('pin') pin: unknown,
  ): Promise<{ message: string }> {
    return this.runner.verifyPin(user, id, pin);
  }

  private str(v: unknown): string | null {
    if (v === undefined || v === null || v === '') return null;
    return String(v);
  }

  private num(v: unknown): number | null {
    if (v === undefined || v === null || v === '') return null;
    return Number(v);
  }
}
