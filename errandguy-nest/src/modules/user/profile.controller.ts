import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SanctumService } from '../../common/auth/sanctum.service';
import { SupabaseStorageService, UploadFile } from '../../integrations/supabase-storage.service';
import { SanctumAuthGuard } from '../../common/auth/auth.guard';
import { ActiveGuard } from '../../common/auth/active.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { userResource } from '../../common/resources/user.resource';
import { LaravelValidationException } from '../../common/exceptions/validation.exception';
import type { AuthConfig } from '../../config/configuration';
import { ConfigService } from '@nestjs/config';
import { UpdateFcmTokenDto, UpdateProfileDto } from './dto/user.dto';

const ALLOWED_AVATAR_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

@Controller('user')
@UseGuards(SanctumAuthGuard, ActiveGuard)
export class ProfileController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sanctum: SanctumService,
    private readonly storage: SupabaseStorageService,
    private readonly config: ConfigService,
  ) {}

  @Get('profile')
  async show(@CurrentUser() user: User): Promise<Record<string, unknown>> {
    const fresh = await this.prisma.user.findUnique({
      where: { id: user.id },
      include: { runnerProfile: { include: { documents: true } } },
    });
    return { data: userResource(fresh!, user.id) };
  }

  @Put('profile')
  async update(
    @CurrentUser() user: User,
    @Body() dto: UpdateProfileDto,
  ): Promise<Record<string, unknown>> {
    if (dto.email !== undefined) {
      const clash = await this.prisma.user.findFirst({
        where: { email: dto.email, NOT: { id: user.id } },
      });
      if (clash) throw LaravelValidationException.field('email', 'The email has already been taken.');
    }
    if (dto.phone !== undefined) {
      const clash = await this.prisma.user.findFirst({
        where: { phone: dto.phone, NOT: { id: user.id } },
      });
      if (clash) throw LaravelValidationException.field('phone', 'The phone has already been taken.');
    }

    const data: Record<string, unknown> = {};
    if (dto.full_name !== undefined) data.fullName = dto.full_name;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.default_lat !== undefined) data.defaultLat = dto.default_lat;
    if (dto.default_lng !== undefined) data.defaultLng = dto.default_lng;

    await this.prisma.user.update({ where: { id: user.id }, data });

    if (dto.role === 'runner') {
      const existing = await this.prisma.runnerProfile.findUnique({ where: { userId: user.id } });
      if (!existing) {
        await this.prisma.runnerProfile.create({
          data: { userId: user.id, verificationStatus: 'pending' },
        });
      }
    }

    const fresh = await this.prisma.user.findUnique({
      where: { id: user.id },
      include: { runnerProfile: { include: { documents: true } } },
    });
    return { data: userResource(fresh!, user.id), message: 'Profile updated successfully.' };
  }

  @Post('avatar')
  @UseInterceptors(FileInterceptor('avatar', { limits: { fileSize: 12 * 1024 * 1024 } }))
  async uploadAvatar(
    @CurrentUser() user: User,
    @UploadedFile() file?: { buffer: Buffer; mimetype: string; originalname: string; size: number },
  ): Promise<Record<string, unknown>> {
    if (!file) throw LaravelValidationException.field('avatar', 'The avatar field is required.');
    if (!ALLOWED_AVATAR_MIME.includes(file.mimetype)) {
      throw LaravelValidationException.field('avatar', 'The avatar must be a file of type: jpg, jpeg, png, webp.');
    }
    if (file.size > 2048 * 1024) {
      throw LaravelValidationException.field('avatar', 'The avatar must not be greater than 2048 kilobytes.');
    }

    const uf: UploadFile = { buffer: file.buffer, mimetype: file.mimetype, originalname: file.originalname };
    const url = await this.storage.uploadAvatar(user.id, uf);
    if (!url) {
      throw new HttpException({ message: 'Failed to upload avatar.' }, HttpStatus.BAD_GATEWAY);
    }
    const fresh = await this.prisma.user.update({
      where: { id: user.id },
      data: { avatarUrl: url },
    });
    return { data: userResource(fresh, user.id), message: 'Avatar uploaded successfully.' };
  }

  @Put('fcm-token')
  async updateFcmToken(
    @CurrentUser() user: User,
    @Body() dto: UpdateFcmTokenDto,
  ): Promise<{ message: string }> {
    await this.prisma.user.update({ where: { id: user.id }, data: { fcmToken: dto.fcm_token } });
    return { message: 'FCM token updated successfully.' };
  }

  @Delete('account')
  @HttpCode(HttpStatus.OK)
  async deleteAccount(@CurrentUser() user: User): Promise<{ message: string }> {
    const activeBooking = await this.prisma.booking.findFirst({
      where: {
        OR: [{ customerId: user.id }, { runnerId: user.id }],
        status: { notIn: ['completed', 'cancelled', 'no_runner'] },
      },
      select: { id: true },
    });
    if (activeBooking) {
      throw new HttpException(
        {
          message:
            'You have an active errand in progress. Please complete or cancel it before deleting your account.',
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const balance = Number(user.walletBalance);
    if (balance > 0) {
      const formatted = balance.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      throw new HttpException(
        { message: `Your wallet balance is ₱${formatted}. Please withdraw it before deleting your account.` },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        fullName: 'Deleted User',
        email: null,
        phone: null,
        avatarUrl: null,
        fcmToken: null,
        defaultLat: null,
        defaultLng: null,
      },
    });
    const userType = this.config.get<AuthConfig>('auth')!.tokenableUserType;
    await this.sanctum.deleteAllTokens(userType, user.id);
    await this.prisma.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });

    return { message: 'Account deleted successfully.' };
  }
}
