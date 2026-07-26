import { Injectable, NotFoundException } from '@nestjs/common';
import type { ErrandType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../payment/system-config.service';
import { CacheService } from '../../cache/cache.service';

const VEHICLE_BASE_PREMIUM: Record<string, number> = {
  walk: 0,
  bicycle: 10,
  motorcycle: 25,
  car: 60,
};

export interface PriceBreakdown {
  base_fee: number;
  vehicle_premium: number;
  distance_km: number;
  distance_fee: number;
  service_fee: number;
  surcharge: number;
  total_amount: number;
  runner_payout: number;
  vehicle_type: string;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Port of PricingService (money math). */
@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly cache: CacheService,
  ) {}

  // Cache the (static) ErrandType row across requests so the fare-estimate hot
  // path — fired continuously as the pin drags — doesn't re-read the same PK
  // row. Caching the ROW (not the price) is safe: distance is still recomputed
  // per request. Short TTL bounds staleness because Nest admin fee-editing isn't
  // ported yet; when it lands, also forget `errand_type:${id}` (see cache P37). (P20)
  private getErrandType(id: string): Promise<ErrandType | null> {
    return this.cache.remember(
      `errand_type:${id}`,
      () => this.prisma.errandType.findUnique({ where: { id } }),
      60,
    );
  }

  async calculate(
    errandTypeId: string,
    pickupLat: number,
    pickupLng: number,
    dropoffLat: number | null,
    dropoffLng: number | null,
    vehicleType: string,
    _scheduleType = 'now',
    // P1/P20 in-request dedup: pass the already-loaded row to avoid re-fetching
    // it. `undefined` = "not provided, load it"; an explicit `null` = "known
    // absent" (throws below without a redundant lookup), preserving prior behavior.
    preloadedErrandType?: ErrandType | null,
  ): Promise<PriceBreakdown> {
    const errandType =
      preloadedErrandType !== undefined ? preloadedErrandType : await this.getErrandType(errandTypeId);
    if (!errandType) throw new NotFoundException({ message: 'Not found.' });

    const distanceKm =
      dropoffLat !== null && dropoffLng !== null
        ? this.haversine(pickupLat, pickupLng, dropoffLat, dropoffLng)
        : 0;

    const baseFee = Number(errandType.baseFee);
    const vehiclePremium = VEHICLE_BASE_PREMIUM[vehicleType] ?? 0;
    const perKmRate = this.perKmRate(errandType, vehicleType);
    const distanceFee = round2(distanceKm * perKmRate);

    const platformFeePercent = Number((await this.config.getValue('platform_fee_percent', '15')) ?? '15');
    const subtotal = baseFee + vehiclePremium + distanceFee;
    const serviceFee = round2(subtotal * (platformFeePercent / 100));
    const surcharge = Number(errandType.surcharge);

    const totalAmount = round2(subtotal + serviceFee + surcharge);
    const runnerPayout = round2(totalAmount - serviceFee);

    return {
      base_fee: baseFee,
      vehicle_premium: vehiclePremium,
      distance_km: round2(distanceKm),
      distance_fee: distanceFee,
      service_fee: serviceFee,
      surcharge,
      total_amount: totalAmount,
      runner_payout: Math.max(0, runnerPayout),
      vehicle_type: vehicleType,
    };
  }

  async estimate(
    errandTypeId: string,
    pickupLat: number,
    pickupLng: number,
    dropoffLat: number | null,
    dropoffLng: number | null,
  ): Promise<Record<string, unknown>> {
    // Load the row ONCE (cached) and thread it through every per-vehicle
    // calculate() below, instead of each of them re-reading the same PK row —
    // previously 1 + N identical lookups per fare-estimate request. (P20)
    const errandType = await this.getErrandType(errandTypeId);
    const vehicleTypes = this.supportedVehicleTypes(errandType);

    const estimates: Record<string, unknown> = {};
    for (const type of vehicleTypes) {
      estimates[type] = await this.calculate(
        errandTypeId,
        pickupLat,
        pickupLng,
        dropoffLat,
        dropoffLng,
        type,
        'now',
        errandType,
      );
    }

    const distanceKm =
      dropoffLat !== null && dropoffLng !== null
        ? round2(this.haversine(pickupLat, pickupLng, dropoffLat, dropoffLng))
        : 0;
    estimates.distance_km = distanceKm;

    if (errandType) {
      const minNegotiate = Number(errandType.minNegotiateFee);
      estimates.min_negotiate_fee = minNegotiate;
      estimates.vehicle_types = vehicleTypes;

      const totals = vehicleTypes.map((t) => Number((estimates[t] as PriceBreakdown)?.total_amount ?? 0));
      const maxTotal = totals.length ? Math.max(...totals) : 0;
      const positiveTotals = totals.filter((t) => t > 0);
      const minTotal = positiveTotals.length ? Math.min(...positiveTotals) : minNegotiate;
      estimates.recommended_min = Math.max(minNegotiate, round2(minTotal));
      estimates.recommended_max = Math.max(1000, round2(maxTotal * 3));
    }
    return estimates;
  }

  /**
   * Negotiate mode: the customer's OFFER is the total they pay; the platform
   * keeps its flat computed service fee (the offer only changes the runner's
   * share). Mirrors Laravel PricingService::applyNegotiateOffer (H11) — without
   * it, a negotiate booking is charged the fixed fare and customer_offer is
   * cosmetic.
   */
  applyNegotiateOffer(pricing: PriceBreakdown, offer: number): PriceBreakdown {
    const total = round2(offer);
    return {
      ...pricing,
      total_amount: total,
      runner_payout: Math.max(0, round2(total - pricing.service_fee)),
    };
  }

  applyPromo(
    subtotal: number,
    promo: { discount_type: string; discount_value: number; max_discount?: number | null },
  ): { discount: number; discounted_total: number } {
    let discount =
      promo.discount_type === 'percentage'
        ? round2(subtotal * (promo.discount_value / 100))
        : Number(promo.discount_value);
    if (promo.max_discount && discount > Number(promo.max_discount)) discount = Number(promo.max_discount);
    discount = Math.min(discount, subtotal);
    return { discount: round2(discount), discounted_total: round2(subtotal - discount) };
  }

  private supportedVehicleTypes(errandType: ErrandType | null): string[] {
    const fallback = ['walk', 'bicycle', 'motorcycle', 'car'];
    if (!errandType) return fallback;
    const candidates: Record<string, number> = {
      walk: Number(errandType.perKmWalk),
      bicycle: Number(errandType.perKmBicycle),
      motorcycle: Number(errandType.perKmMotorcycle),
      car: Number(errandType.perKmCar),
    };
    const supported = Object.keys(candidates).filter((k) => candidates[k] > 0);
    return supported.length ? supported : fallback;
  }

  private perKmRate(errandType: ErrandType, vehicleType: string): number {
    switch (vehicleType) {
      case 'walk':
        return Number(errandType.perKmWalk);
      case 'bicycle':
        return Number(errandType.perKmBicycle);
      case 'motorcycle':
        return Number(errandType.perKmMotorcycle);
      case 'car':
        return Number(errandType.perKmCar);
      default:
        return Number(errandType.perKmMotorcycle);
    }
  }

  private haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const dLat = this.deg2rad(lat2 - lat1);
    const dLng = this.deg2rad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private deg2rad(d: number): number {
    return (d * Math.PI) / 180;
  }
}
