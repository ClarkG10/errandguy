import { Body, Controller, HttpCode, HttpException, HttpStatus, Put, UseGuards } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SanctumAuthGuard } from '../../common/auth/auth.guard';
import { ActiveGuard } from '../../common/auth/active.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { LaravelValidationException, ValidationErrors } from '../../common/exceptions/validation.exception';
import { asArray } from '../../common/serialization';
import { ToggleOnlineDto } from './dto/runner.dto';

@Controller('runner')
@UseGuards(SanctumAuthGuard, ActiveGuard, RolesGuard)
@Roles('runner')
export class RunnerOnlineController {
  constructor(private readonly prisma: PrismaService) {}

  @Put('online')
  @HttpCode(HttpStatus.OK)
  async toggle(@CurrentUser() user: User, @Body() dto: ToggleOnlineDto): Promise<Record<string, unknown>> {
    const goingOnline = dto.is_online === true;

    // `lat`/`lng` are required_if:is_online,true (FormRequest runs first).
    if (goingOnline) {
      const errors: ValidationErrors = {};
      if (dto.lat === undefined || dto.lat === null) errors.lat = ['Location is required when going online.'];
      if (dto.lng === undefined || dto.lng === null) errors.lng = ['Location is required when going online.'];
      if (Object.keys(errors).length) throw new LaravelValidationException(errors);
    }

    const profile = await this.prisma.runnerProfile.findUnique({ where: { userId: user.id } });
    if (!profile) {
      throw new HttpException({ message: 'Runner profile not found. Please complete onboarding.' }, HttpStatus.NOT_FOUND);
    }

    let isOnline: boolean;
    if (goingOnline) {
      if (profile.verificationStatus !== 'approved') {
        throw new HttpException({ message: 'Your account must be approved before going online.' }, HttpStatus.UNPROCESSABLE_ENTITY);
      }
      if (!asArray(profile.preferredTypes).length) {
        throw new HttpException(
          { message: 'Please set at least one preferred errand type before going online.' },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      const updated = await this.prisma.runnerProfile.update({
        where: { id: profile.id },
        data: { isOnline: true, currentLat: dto.lat, currentLng: dto.lng, lastLocationAt: new Date() },
      });
      isOnline = updated.isOnline;
    } else {
      const activeCount = await this.prisma.booking.count({
        where: { runnerId: user.id, status: { notIn: ['completed', 'cancelled', 'pending'] } },
      });
      if (activeCount > 0) {
        throw new HttpException(
          { message: 'You cannot go offline while you have an active errand.' },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      const updated = await this.prisma.runnerProfile.update({ where: { id: profile.id }, data: { isOnline: false } });
      isOnline = updated.isOnline;
    }

    return {
      data: { is_online: isOnline },
      message: goingOnline ? 'You are now online.' : 'You are now offline.',
    };
  }
}
