import { Injectable } from '@nestjs/common';
import { PromoCode } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Thrown by validate() → mapped to 422 {message} by callers. */
export class PromoInvalidError extends Error {}

export interface PromoValidation {
  id: string;
  code: string;
  description: string | null;
  discount_type: string;
  discount_value: number;
  max_discount: number;
  discount: number;
}

/** Port of PromoService. */
@Injectable()
export class PromoService {
  constructor(private readonly prisma: PrismaService) {}

  async validate(code: string, userId: string, bookingAmount: number): Promise<PromoValidation> {
    const promo = await this.prisma.promoCode.findFirst({
      where: { code: code.trim().toUpperCase(), isActive: true },
    });
    if (!promo) throw new PromoInvalidError('Invalid or expired promo code.');

    const now = new Date();
    if (promo.validFrom && now < promo.validFrom) {
      throw new PromoInvalidError('This promo code is not yet active.');
    }
    if (promo.validUntil && now > promo.validUntil) {
      throw new PromoInvalidError('This promo code has expired.');
    }
    if (promo.usageLimit !== null && promo.usedCount >= promo.usageLimit) {
      throw new PromoInvalidError('This promo code has reached its usage limit.');
    }
    if (promo.perUserLimit !== null) {
      const userUsage = await this.prisma.booking.count({
        where: { customerId: userId, promoCodeId: promo.id, status: { notIn: ['cancelled'] } },
      });
      if (userUsage >= promo.perUserLimit) {
        throw new PromoInvalidError('You have already used this promo code the maximum number of times.');
      }
    }
    const minOrder = Number(promo.minOrder);
    if (minOrder && bookingAmount < minOrder) {
      throw new PromoInvalidError(`Minimum order of ₱${promo.minOrder.toString()} required for this promo.`);
    }

    const discount = this.calculateDiscount(promo, bookingAmount);
    return {
      id: promo.id,
      code: promo.code,
      description: promo.description,
      discount_type: promo.discountType,
      discount_value: Number(promo.discountValue),
      max_discount: Number(promo.maxDiscount ?? 0),
      discount,
    };
  }

  /** Increment used_count + stamp the booking's promo_code_id, atomically. */
  async redeem(promoCodeId: string, bookingId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.promoCode.update({ where: { id: promoCodeId }, data: { usedCount: { increment: 1 } } }),
      this.prisma.booking.update({ where: { id: bookingId }, data: { promoCodeId } }),
    ]);
  }

  calculateDiscount(promo: PromoCode, amount: number): number {
    let discount: number;
    if (promo.discountType === 'percentage') {
      discount = Math.round(amount * (Number(promo.discountValue) / 100) * 100) / 100;
    } else {
      discount = Number(promo.discountValue);
    }
    const max = promo.maxDiscount ? Number(promo.maxDiscount) : null;
    if (max && discount > max) discount = max;
    return Math.min(discount, amount);
  }

  /**
   * scopeValid + per-user filter for the browse endpoint: active, inside the
   * validity window, not globally exhausted, and not already redeemed by the
   * user up to their per-user limit. Ordered by valid_from desc.
   */
  async listRedeemable(userId: string): Promise<PromoCode[]> {
    const now = new Date();
    const candidates = await this.prisma.promoCode.findMany({
      where: { isActive: true, validFrom: { lte: now }, validUntil: { gte: now } },
      orderBy: { validFrom: 'desc' },
    });
    if (candidates.length === 0) return [];

    // Per-user redemption counts for ALL candidate promos in ONE grouped
    // aggregate instead of a `booking.count()` per promo (previously N+1: one
    // sequential round-trip per active promo on this public browse endpoint).
    // NOTE: intentionally NO status filter here — listRedeemable counts ALL of
    // the user's bookings for a promo (incl. cancelled), matching the prior
    // per-promo count. Do NOT copy validate()'s `notIn: ['cancelled']`.
    const grouped = await this.prisma.booking.groupBy({
      by: ['promoCodeId'],
      where: { customerId: userId, promoCodeId: { in: candidates.map((p) => p.id) } },
      _count: { _all: true },
    });
    const usedByPromo = new Map<string, number>(
      grouped.map((g) => [g.promoCodeId as string, g._count._all]),
    );

    const out: PromoCode[] = [];
    for (const p of candidates) {
      if (p.usageLimit !== null && p.usedCount >= p.usageLimit) continue;
      const used = usedByPromo.get(p.id) ?? 0;
      // Preserve the existing `null > n === false` behaviour for a null
      // perUserLimit (such promos are not surfaced by the browse endpoint).
      if (p.perUserLimit > used) out.push(p);
    }
    return out;
  }
}
