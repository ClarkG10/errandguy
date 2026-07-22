import { Body, Controller, HttpCode, HttpException, HttpStatus, Post, UseGuards } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../cache/cache.service';
import { LocationService } from '../booking/location.service';
import { SanctumAuthGuard } from '../../common/auth/auth.guard';
import { ActiveGuard } from '../../common/auth/active.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { RouteThrottle } from '../../common/throttling/throttle.decorators';
import { UpdateLocationDto } from './dto/runner.dto';

const INACTIVE_STATUSES = ['completed', 'cancelled', 'pending', 'no_runner'];

@Controller('runner')
@UseGuards(SanctumAuthGuard, ActiveGuard, RolesGuard)
@Roles('runner')
export class RunnerLocationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly location: LocationService,
  ) {}

  @Post('location')
  @HttpCode(HttpStatus.OK)
  @RouteThrottle(120, 1)
  async store(@CurrentUser() user: User, @Body() dto: UpdateLocationDto): Promise<{ message: string }> {
    // iOS / Android send -1 for unknown heading/speed — sanitize to null.
    const speed = typeof dto.speed === 'number' && dto.speed < 0 ? null : dto.speed ?? null;
    const heading = typeof dto.heading === 'number' && dto.heading < 0 ? null : dto.heading ?? null;

    const clientBookingId = dto.booking_id ?? null;
    let activeBookingId: string | null = null;

    // Trust a client-supplied booking id only after verifying ownership + phase.
    if (clientBookingId) {
      const owns = await this.prisma.booking.findFirst({
        where: { id: clientBookingId, runnerId: user.id, status: { notIn: INACTIVE_STATUSES } },
        select: { id: true },
      });
      if (owns) activeBookingId = clientBookingId;
    }

    if (activeBookingId === null) {
      const cacheKey = `runner_active_booking_id:${user.id}`;
      activeBookingId = await this.cache.remember(
        cacheKey,
        async () => {
          const active = await this.prisma.booking.findFirst({
            where: { runnerId: user.id, status: { notIn: INACTIVE_STATUSES } },
            select: { id: true },
          });
          return active?.id ?? null;
        },
        30,
      );
    }

    const updated = await this.location.updateRunnerLocation(
      user.id,
      { lat: dto.lat, lng: dto.lng, heading, speed, accuracy: dto.accuracy ?? null },
      activeBookingId,
    );

    if (!updated) {
      throw new HttpException(
        { message: 'Location update throttled. Try again in a few seconds.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return { message: 'Location updated.' };
  }
}
