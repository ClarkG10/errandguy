import {
  Controller,
  Delete,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SanctumAuthGuard } from '../../common/auth/auth.guard';
import { ActiveGuard } from '../../common/auth/active.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { RouteThrottle } from '../../common/throttling/throttle.decorators';
import { SOSService } from './sos.service';
import { sosAlertResource } from './sos-alert.resource';

@Controller('runner/errand')
@UseGuards(SanctumAuthGuard, ActiveGuard, RolesGuard)
@Roles('runner')
export class RunnerSosController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sos: SOSService,
  ) {}

  /**
   * Trigger SOS while a runner is on an active errand. The runner must own the
   * booking and the booking must still be in-flight.
   */
  @Post(':id/sos')
  @HttpCode(HttpStatus.CREATED)
  @RouteThrottle(6, 1)
  async trigger(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<Record<string, unknown>> {
    const booking = await this.prisma.booking.findFirst({
      where: {
        id,
        runnerId: user.id,
        status: { notIn: ['completed', 'cancelled', 'no_runner'] },
      },
    });
    if (!booking) throw new HttpException({ message: 'Not found.' }, HttpStatus.NOT_FOUND);

    const alert = await this.sos.triggerSOS(booking.id, user.id, 'runner');

    return {
      data: sosAlertResource(alert),
      message: 'SOS alert triggered. Emergency contacts have been notified.',
    };
  }

  @Delete(':id/sos')
  @RouteThrottle(10, 1)
  async deactivate(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<{ message: string }> {
    const booking = await this.prisma.booking.findFirst({
      where: { id, runnerId: user.id },
    });
    if (!booking) throw new HttpException({ message: 'Not found.' }, HttpStatus.NOT_FOUND);

    await this.sos.deactivateSOS(id);

    return { message: 'SOS alert deactivated.' };
  }
}
