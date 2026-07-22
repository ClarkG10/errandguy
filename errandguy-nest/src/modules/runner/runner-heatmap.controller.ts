import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../cache/cache.service';
import { SanctumAuthGuard } from '../../common/auth/auth.guard';
import { ActiveGuard } from '../../common/auth/active.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';

/** SWR soft / hard TTL (seconds): fresh for 15m, physically kept for 30m. */
const SWR_SOFT = 900;
const SWR_HARD = 1800;

interface HeatCell {
  lat: number;
  lng: number;
  weight: number;
}

/** Read-only demand aggregates that help runners position themselves. */
@Controller('runner')
@UseGuards(SanctumAuthGuard, ActiveGuard, RolesGuard)
@Roles('runner')
export class RunnerHeatmapController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  @Get('heatmap')
  async heatmap(@Query() query: Record<string, unknown>): Promise<Record<string, unknown>> {
    const days = this.clampDays(this.intParam(query.days, 14), 90);
    const cutoff = new Date(Date.now() - days * 86_400_000);

    const cells = await this.cache.swr<HeatCell[]>(`runner:heatmap:${days}`, SWR_SOFT, SWR_HARD, async () => {
      const rows = await this.prisma.$queryRaw<{ lat: unknown; lng: unknown; weight: bigint }[]>(Prisma.sql`
        SELECT round(pickup_lat::numeric, 3) AS lat,
               round(pickup_lng::numeric, 3) AS lng,
               count(*) AS weight
        FROM bookings
        WHERE pickup_lat IS NOT NULL AND pickup_lng IS NOT NULL AND created_at >= ${cutoff}
        GROUP BY round(pickup_lat::numeric, 3), round(pickup_lng::numeric, 3)
      `);
      return rows.map((r) => ({ lat: Number(r.lat), lng: Number(r.lng), weight: Number(r.weight) }));
    });

    return { data: { days, cells } };
  }

  @Get('peak-hours')
  async peakHours(@Query() query: Record<string, unknown>): Promise<Record<string, unknown>> {
    const days = this.clampDays(this.intParam(query.days, 30), 90);
    const cutoff = new Date(Date.now() - days * 86_400_000);

    const grid = await this.cache.swr<number[][]>(`runner:peak_hours:${days}`, SWR_SOFT, SWR_HARD, async () => {
      const rows = await this.prisma.$queryRaw<{ dow: unknown; hour: unknown; c: bigint }[]>(Prisma.sql`
        SELECT extract(dow from created_at) AS dow,
               extract(hour from created_at) AS hour,
               count(*) AS c
        FROM bookings
        WHERE created_at >= ${cutoff}
        GROUP BY extract(dow from created_at), extract(hour from created_at)
      `);
      const g: number[][] = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
      for (const row of rows) {
        const dow = Number(row.dow);
        const hour = Number(row.hour);
        if (dow >= 0 && dow <= 6 && hour >= 0 && hour <= 23) g[dow][hour] = Number(row.c);
      }
      return g;
    });

    return { data: { days, grid } };
  }

  private clampDays(days: number, max: number): number {
    return Math.max(1, Math.min(days, max));
  }

  /** Mirrors Laravel `$request->integer('days', default)` — (int) cast, 0 on garbage. */
  private intParam(value: unknown, fallback: number): number {
    if (value === undefined || value === null || value === '') return fallback;
    const n = parseInt(String(value), 10);
    return Number.isNaN(n) ? 0 : n;
  }
}
