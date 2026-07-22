import { Injectable, Logger } from '@nestjs/common';
import type { RunnerLocation, RunnerProfile, User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../cache/cache.service';

export interface Coords {
  lat: number;
  lng: number;
  heading?: number | null;
  speed?: number | null;
  accuracy?: number | null;
}

const R_KM = 6371;
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (d: number): number => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Port of LocationService. */
@Injectable()
export class LocationService {
  private readonly logger = new Logger('Location');

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  /** Throttled to 1 update / 5s / runner (atomic Cache::add). Returns false if throttled. */
  async updateRunnerLocation(runnerId: string, coords: Coords, bookingId?: string | null): Promise<boolean> {
    if (!this.cache.add(`runner_location_throttle:${runnerId}`, true, 5)) return false;

    await this.prisma.runnerLocation.create({
      data: {
        runnerId,
        bookingId: bookingId ?? null,
        lat: coords.lat,
        lng: coords.lng,
        heading: coords.heading ?? null,
        speed: coords.speed ?? null,
        accuracy: coords.accuracy ?? null,
      },
    });
    await this.prisma.runnerProfile.updateMany({
      where: { userId: runnerId },
      data: { currentLat: coords.lat, currentLng: coords.lng, lastLocationAt: new Date() },
    });
    return true;
  }

  async getRunnerLocation(runnerId: string): Promise<RunnerLocation | null> {
    return this.prisma.runnerLocation.findFirst({
      where: { runnerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getNearbyRunners(
    lat: number,
    lng: number,
    radiusKm: number,
    vehicleType?: string | null,
    errandTypeId?: string | null,
  ): Promise<(RunnerProfile & { user: User })[]> {
    const latDelta = radiusKm / 111.0;
    const cosLat = Math.cos((lat * Math.PI) / 180);
    const lngDelta = cosLat > 0.01 ? radiusKm / (111.0 * cosLat) : 180.0;

    const runners = await this.prisma.runnerProfile.findMany({
      where: {
        isOnline: true,
        verificationStatus: 'approved',
        currentLat: { not: null, gte: lat - latDelta, lte: lat + latDelta },
        currentLng: { not: null, gte: lng - lngDelta, lte: lng + lngDelta },
        ...(vehicleType ? { vehicleType } : {}),
      },
      include: { user: true },
    });

    const errandTypeSlug = errandTypeId
      ? (await this.prisma.errandType.findUnique({ where: { id: errandTypeId }, select: { slug: true } }))?.slug ?? null
      : null;

    return runners
      .filter((runner) => {
        const distance = haversine(lat, lng, Number(runner.currentLat), Number(runner.currentLng));
        if (distance > radiusKm) return false;
        if (errandTypeSlug) {
          const preferred = (runner.preferredTypes as string[]) ?? [];
          if (preferred.length && !preferred.includes(errandTypeSlug)) return false;
        }
        return true;
      })
      .map((r) => r as RunnerProfile & { user: User });
  }

  async cleanupOldLocations(): Promise<number> {
    const { count } = await this.prisma.runnerLocation.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - 24 * 3600 * 1000) } },
    });
    this.logger.log(`Cleaned up ${count} old runner location records.`);
    return count;
  }
}
