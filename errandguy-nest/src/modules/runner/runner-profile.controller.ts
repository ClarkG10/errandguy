import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import type { Prisma, User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SanctumAuthGuard } from '../../common/auth/auth.guard';
import { ActiveGuard } from '../../common/auth/active.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { runnerProfileResource } from '../../common/resources/runner-profile.resource';
import { LaravelValidationException, ValidationErrors } from '../../common/exceptions/validation.exception';
import { UpdateRunnerProfileDto } from './dto/runner.dto';
import { encryptBankAccount } from './runner.crypto';

@Controller('runner')
@UseGuards(SanctumAuthGuard, ActiveGuard, RolesGuard)
@Roles('runner')
export class RunnerProfileController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('profile')
  async show(@CurrentUser() user: User): Promise<Record<string, unknown>> {
    let profile = await this.prisma.runnerProfile.findUnique({ where: { userId: user.id } });
    if (!profile) {
      profile = await this.prisma.runnerProfile.create({ data: { userId: user.id, verificationStatus: 'pending' } });
    }
    const withDocs = await this.prisma.runnerProfile.findUniqueOrThrow({
      where: { id: profile.id },
      include: { documents: { orderBy: { createdAt: 'asc' } } },
    });
    return { data: runnerProfileResource(withDocs, user.id) };
  }

  @Put('profile')
  async update(@CurrentUser() user: User, @Body() dto: UpdateRunnerProfileDto): Promise<Record<string, unknown>> {
    let profile = await this.prisma.runnerProfile.findUnique({ where: { userId: user.id } });
    if (!profile) {
      profile = await this.prisma.runnerProfile.create({ data: { userId: user.id, verificationStatus: 'pending' } });
    }

    // preferred_types.* must reference active errand-type slugs.
    if (dto.preferred_types !== undefined) {
      const found = await this.prisma.errandType.findMany({
        where: { slug: { in: dto.preferred_types }, isActive: true },
        select: { slug: true },
      });
      const valid = new Set(found.map((e) => e.slug));
      const errors: ValidationErrors = {};
      dto.preferred_types.forEach((slug, i) => {
        if (!valid.has(slug)) errors[`preferred_types.${i}`] = [`The selected preferred types.${i} is invalid.`];
      });
      if (Object.keys(errors).length) throw new LaravelValidationException(errors);
    }

    const data: Prisma.RunnerProfileUpdateInput = {};
    if (dto.vehicle_type !== undefined) data.vehicleType = dto.vehicle_type;
    if (dto.vehicle_plate !== undefined) data.vehiclePlate = dto.vehicle_plate;
    if (dto.preferred_types !== undefined) data.preferredTypes = dto.preferred_types;
    if (dto.working_area_lat !== undefined) data.workingAreaLat = dto.working_area_lat;
    if (dto.working_area_lng !== undefined) data.workingAreaLng = dto.working_area_lng;
    if (dto.working_area_radius !== undefined) data.workingAreaRadius = dto.working_area_radius;
    if (dto.bank_name !== undefined) data.bankName = dto.bank_name;
    if (dto.bank_account_number !== undefined) data.bankAccountNumber = encryptBankAccount(dto.bank_account_number);
    if (dto.ewallet_number !== undefined) data.ewalletNumber = dto.ewallet_number;

    await this.prisma.runnerProfile.update({ where: { id: profile.id }, data });

    const withDocs = await this.prisma.runnerProfile.findUniqueOrThrow({
      where: { id: profile.id },
      include: { documents: { orderBy: { createdAt: 'asc' } } },
    });
    return { data: runnerProfileResource(withDocs, user.id), message: 'Profile updated successfully.' };
  }
}
