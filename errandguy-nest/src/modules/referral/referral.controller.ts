import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SanctumAuthGuard } from '../../common/auth/auth.guard';
import { ActiveGuard } from '../../common/auth/active.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { RouteThrottle } from '../../common/throttling/throttle.decorators';
import type { AppConfig } from '../../config/configuration';
import { ReferralService, ReferralError } from './referral.service';
import { referralResource } from './referral.resource';
import { ApplyReferralDto } from './dto/apply-referral.dto';

@Controller('user')
@UseGuards(SanctumAuthGuard, ActiveGuard)
export class ReferralController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly referral: ReferralService,
    private readonly config: ConfigService,
  ) {}

  @Get('referral')
  async show(@CurrentUser() user: User): Promise<Record<string, unknown>> {
    let code = user.referralCode;
    if (!code) {
      code = await this.referral.generateCode();
      await this.prisma.user.update({ where: { id: user.id }, data: { referralCode: code } });
    }

    const grouped = await this.prisma.referral.groupBy({
      by: ['status'],
      where: { referrerId: user.id },
      _count: { _all: true },
    });
    const counts: Record<string, number> = { pending: 0, qualified: 0, rewarded: 0 };
    for (const g of grouped) {
      if (g.status in counts) counts[g.status] = g._count._all;
    }

    const earned = await this.prisma.referral.aggregate({
      where: { referrerId: user.id, status: 'rewarded' },
      _sum: { rewardAmount: true },
    });

    const baseUrl = this.config.get<AppConfig>('app')!.url.replace(/\/+$/, '');

    return {
      data: {
        referral_code: code,
        share_link: `${baseUrl}/r/${code}`,
        counts: {
          pending: counts.pending,
          qualified: counts.qualified,
          rewarded: counts.rewarded,
        },
        total_earned: Number(earned._sum.rewardAmount ?? 0),
      },
    };
  }

  @Post('referral/apply')
  @HttpCode(HttpStatus.CREATED)
  @RouteThrottle(10, 1)
  async apply(
    @CurrentUser() user: User,
    @Body() dto: ApplyReferralDto,
  ): Promise<Record<string, unknown>> {
    try {
      const referral = await this.referral.attach(user.id, dto.code);
      return {
        data: referralResource(referral, user.id),
        message:
          'Referral code applied. You and your friend will earn a reward once you complete your first errand.',
      };
    } catch (e) {
      if (e instanceof ReferralError) {
        const map: Record<string, string> = {
          invalid_code: 'That referral code is not valid.',
          self_referral: 'You cannot use your own referral code.',
          already_referred: 'You have already used a referral code.',
        };
        throw new HttpException(
          { message: map[e.message] ?? 'Could not apply referral code.' },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      throw e;
    }
  }
}
