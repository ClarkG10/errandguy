import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { PromoCode, User } from '@prisma/client';
import { SanctumAuthGuard } from '../../common/auth/auth.guard';
import { ActiveGuard } from '../../common/auth/active.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { toFloat, iso } from '../../common/serialization';
import { PromoService, PromoInvalidError } from './promo.service';

/** Mirrors PromoResource (numbers, not decimal strings). */
function promoResource(p: PromoCode): Record<string, unknown> {
  return {
    id: p.id,
    code: p.code,
    description: p.description,
    discount_type: p.discountType,
    discount_value: Number(p.discountValue),
    max_discount: p.maxDiscount !== null ? Number(p.maxDiscount) : null,
    min_order: p.minOrder !== null ? toFloat(p.minOrder) : null,
    valid_until: iso(p.validUntil),
  };
}

@Controller()
@UseGuards(SanctumAuthGuard, ActiveGuard)
export class PromoController {
  constructor(private readonly promo: PromoService) {}

  @Get('promos')
  async index(@CurrentUser() user: User): Promise<{ data: unknown[] }> {
    const promos = await this.promo.listRedeemable(user.id);
    return { data: promos.map(promoResource) };
  }

  @Get('promos/validate/:code')
  async validate(
    @CurrentUser() user: User,
    @Param('code') code: string,
    @Query('amount') amount?: string,
  ): Promise<Record<string, unknown>> {
    const amt = Number(amount ?? 0) || 0;
    try {
      const r = await this.promo.validate(code, user.id, amt);
      return {
        data: {
          id: r.id,
          code: r.code,
          discount_type: r.discount_type,
          discount_value: r.discount_value,
          max_discount: r.max_discount,
          description: r.description,
          discount: r.discount,
        },
      };
    } catch (e) {
      if (e instanceof PromoInvalidError) {
        throw new HttpException({ message: e.message }, HttpStatus.UNPROCESSABLE_ENTITY);
      }
      throw e;
    }
  }
}
