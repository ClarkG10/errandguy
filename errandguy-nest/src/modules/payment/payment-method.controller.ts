import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../cache/cache.service';
import { SanctumAuthGuard } from '../../common/auth/auth.guard';
import { ActiveGuard } from '../../common/auth/active.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { RouteThrottle } from '../../common/throttling/throttle.decorators';
import { PaymentGatewayException } from '../../common/exceptions/payment-gateway.exception';
import type { AppConfig } from '../../config/configuration';
import { PaymentService } from './payment.service';
import { PaymentMethodCatalog } from './payment-method-catalog';
import { paymentMethodResource } from './payment.resource';
import { LinkMethodDto, StoreMethodDto } from './dto/payment-method.dto';

@Controller('payments')
@UseGuards(SanctumAuthGuard, ActiveGuard)
export class PaymentMethodController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly payment: PaymentService,
    private readonly catalog: PaymentMethodCatalog,
    private readonly config: ConfigService,
  ) {}

  @Get('available-methods')
  async available(): Promise<{ data: unknown }> {
    const data = await this.cache.swr('payments:available_methods', 300, 3600, () => this.catalog.enabled());
    return { data };
  }

  @Get('methods')
  async index(@CurrentUser() user: User): Promise<{ data: unknown[] }> {
    const methods = await this.prisma.paymentMethod.findMany({
      where: { userId: user.id, status: { in: ['active', 'pending'] } },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return { data: methods.map(paymentMethodResource) };
  }

  @Post('methods')
  @HttpCode(HttpStatus.CREATED)
  async store(@CurrentUser() user: User, @Body() dto: StoreMethodDto): Promise<{ data: unknown }> {
    const isFirst = (await this.prisma.paymentMethod.count({ where: { userId: user.id } })) === 0;
    const method = await this.prisma.paymentMethod.create({
      data: {
        userId: user.id,
        type: dto.type,
        gatewayToken: dto.gateway_token,
        label: dto.label ?? dto.type.charAt(0).toUpperCase() + dto.type.slice(1),
        lastFour: dto.last_four ?? null,
        cardBrand: dto.card_brand ?? null,
        expiresAt: dto.expires_at ? new Date(dto.expires_at) : null,
        isDefault: isFirst,
      },
    });
    return { data: paymentMethodResource(method) };
  }

  @Post('methods/link')
  @HttpCode(HttpStatus.CREATED)
  @RouteThrottle(10, 1)
  async link(@CurrentUser() user: User, @Body() dto: LinkMethodDto): Promise<Record<string, unknown>> {
    const channelMap: Record<string, string> = { gcash: 'GCASH', maya: 'PAYMAYA', grabpay: 'GRABPAY' };
    const labelMap: Record<string, string> = { gcash: 'GCash', maya: 'Maya', grabpay: 'GrabPay' };
    const returnUrl = `${this.config.get<AppConfig>('app')!.url.replace(/\/+$/, '')}/payment/complete`;

    let pm: any;
    try {
      pm = await this.payment.createLinkedEwallet(user, channelMap[dto.channel], returnUrl, returnUrl);
    } catch (e) {
      const debug = this.config.get<AppConfig>('app')!.env !== 'production';
      const message =
        debug && e instanceof PaymentGatewayException
          ? `Payment gateway error: ${e.reason()}`
          : 'Could not start linking. Please try again.';
      throw new HttpException({ message }, HttpStatus.BAD_GATEWAY);
    }

    const status = String(pm.status ?? 'pending').toLowerCase() === 'active' ? 'active' : 'pending';
    const isFirstActive =
      (await this.prisma.paymentMethod.count({ where: { userId: user.id, status: 'active' } })) === 0;

    const method = await this.prisma.paymentMethod.create({
      data: {
        userId: user.id,
        type: dto.channel,
        status,
        label: labelMap[dto.channel],
        gatewayRef: pm.id ?? null,
        channelCode: channelMap[dto.channel],
        isDefault: isFirstActive && status === 'active',
      },
    });
    return {
      data: paymentMethodResource(method),
      action_url: PaymentService.extractActionUrl(pm),
    };
  }

  @Put('methods/:id/default')
  @HttpCode(HttpStatus.OK)
  async setDefault(@CurrentUser() user: User, @Param('id') id: string): Promise<{ message: string }> {
    await this.prisma.paymentMethod.updateMany({ where: { userId: user.id }, data: { isDefault: false } });
    await this.prisma.paymentMethod.updateMany({ where: { userId: user.id, id }, data: { isDefault: true } });
    return { message: 'Default payment method updated.' };
  }

  @Delete('methods/:id')
  @HttpCode(HttpStatus.OK)
  async destroy(@CurrentUser() user: User, @Param('id') id: string): Promise<{ message: string }> {
    const method = await this.prisma.paymentMethod.findFirst({ where: { id, userId: user.id } });
    if (!method) throw new HttpException({ message: 'Not found.' }, HttpStatus.NOT_FOUND);
    const wasDefault = method.isDefault;
    await this.prisma.paymentMethod.delete({ where: { id } });
    if (wasDefault) {
      const next = await this.prisma.paymentMethod.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: 'asc' },
      });
      if (next) await this.prisma.paymentMethod.update({ where: { id: next.id }, data: { isDefault: true } });
    }
    return { message: 'Payment method removed.' };
  }
}
