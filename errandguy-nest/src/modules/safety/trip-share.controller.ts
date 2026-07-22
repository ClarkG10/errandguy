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
import { ConfigService } from '@nestjs/config';
import type { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SanctumAuthGuard } from '../../common/auth/auth.guard';
import { ActiveGuard } from '../../common/auth/active.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AppConfig } from '../../config/configuration';
import { strRandom } from './str-random';

@Controller('bookings')
@UseGuards(SanctumAuthGuard, ActiveGuard, RolesGuard)
@Roles('customer')
export class TripShareController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Post(':id/share-trip')
  @HttpCode(HttpStatus.OK)
  async share(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<Record<string, unknown>> {
    const booking = await this.prisma.booking.findFirst({
      where: { id, customerId: user.id, status: { notIn: ['completed', 'cancelled'] } },
    });
    if (!booking) throw new HttpException({ message: 'Not found.' }, HttpStatus.NOT_FOUND);

    const token = strRandom(64);

    await this.prisma.booking.update({
      where: { id: booking.id },
      data: { tripShareToken: token, tripShareActive: true },
    });

    const app = this.config.get<AppConfig>('app')!;
    const link = `${app.url}/trip/${token}`;

    return { data: { link, token } };
  }

  @Delete(':id/share-trip')
  async revoke(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<{ message: string }> {
    const booking = await this.prisma.booking.findFirst({
      where: { id, customerId: user.id },
    });
    if (!booking) throw new HttpException({ message: 'Not found.' }, HttpStatus.NOT_FOUND);

    await this.prisma.booking.update({
      where: { id: booking.id },
      data: { tripShareToken: null, tripShareActive: false },
    });

    return { message: 'Trip sharing has been stopped.' };
  }
}
