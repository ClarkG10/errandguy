import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { RunnerProfile, User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../payment/system-config.service';

export type EligibleRunner = RunnerProfile & { user: User; distanceKm: number };

const R_KM = 6371;
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (d: number): number => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Port of MatchingService. */
@Injectable()
export class MatchingService {
  private readonly logger = new Logger('Matching');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

  async findRunner(
    bookingId: string,
    radiusOverrideKm?: number | null,
    excludeUserId?: string | null,
  ): Promise<EligibleRunner | null> {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException({ message: 'Not found.' });

    const radiusKm = radiusOverrideKm ?? Number((await this.config.getValue('matching_radius_km', '10')) ?? '10');
    const runners = await this.getEligibleRunners(
      Number(booking.pickupLat),
      Number(booking.pickupLng),
      radiusKm,
      booking.errandTypeId,
      excludeUserId,
    );
    if (!runners.length) {
      this.logger.log(`No runners found for booking ${bookingId} (radius: ${radiusKm}km)`);
      return null;
    }
    return runners[0];
  }

  async broadcastToRunners(bookingId: string): Promise<EligibleRunner[]> {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException({ message: 'Not found.' });

    const radiusKm = Number((await this.config.getValue('matching_radius_km', '10')) ?? '10');
    const runners = await this.getEligibleRunners(
      Number(booking.pickupLat),
      Number(booking.pickupLng),
      radiusKm,
      booking.errandTypeId,
    );
    await this.prisma.booking.update({
      where: { id: bookingId },
      data: { negotiateExpiresAt: new Date(Date.now() + 30 * 60 * 1000) },
    });
    this.logger.log(`Broadcasting booking ${bookingId} to ${runners.length} runners`);
    return runners;
  }

  private async getEligibleRunners(
    lat: number,
    lng: number,
    radiusKm: number,
    errandTypeId: string,
    excludeUserId?: string | null,
  ): Promise<EligibleRunner[]> {
    const latDelta = (radiusKm * 1.25) / 111.0;
    const cos = Math.max(0.000001, Math.cos((lat * Math.PI) / 180));
    const lngDelta = (radiusKm * 1.25) / (111.0 * cos);
    const freshCutoff = new Date(Date.now() - 5 * 60 * 1000);

    const candidates = await this.prisma.runnerProfile.findMany({
      where: {
        isOnline: true,
        verificationStatus: 'approved',
        currentLat: { not: null, gte: lat - latDelta, lte: lat + latDelta },
        currentLng: { not: null, gte: lng - lngDelta, lte: lng + lngDelta },
        OR: [{ lastLocationAt: { gte: freshCutoff } }, { lastLocationAt: null }],
      },
      include: { user: true },
    });

    // Exclude runners currently holding an active errand.
    const busy = new Set(
      (
        await this.prisma.booking.findMany({
          where: {
            runnerId: { in: candidates.map((c) => c.userId) },
            status: { notIn: ['pending', 'completed', 'cancelled', 'no_runner'] },
          },
          select: { runnerId: true },
        })
      ).map((b) => b.runnerId as string),
    );

    const errandTypeSlug =
      (await this.prisma.errandType.findUnique({ where: { id: errandTypeId }, select: { slug: true } }))?.slug ?? null;

    const eligible: EligibleRunner[] = [];
    for (const runner of candidates) {
      // Skip the just-declined runner so a decline isn't a no-op re-offer.
      if (excludeUserId && runner.userId === excludeUserId) continue;
      if (busy.has(runner.userId)) continue;
      const distance = haversine(lat, lng, Number(runner.currentLat), Number(runner.currentLng));
      if (distance > radiusKm) continue;
      const preferred = (runner.preferredTypes as string[]) ?? [];
      if (preferred.length && errandTypeSlug && !preferred.includes(errandTypeSlug)) continue;
      eligible.push({ ...(runner as RunnerProfile & { user: User }), distanceKm: Math.round(distance * 100) / 100 });
    }

    // Sort: distance asc, acceptance_rate desc.
    eligible.sort((a, b) => {
      if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
      return Number(b.acceptanceRate) - Number(a.acceptanceRate);
    });
    return eligible;
  }
}
