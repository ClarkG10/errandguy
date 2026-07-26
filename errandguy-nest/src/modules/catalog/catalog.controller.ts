import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createHash } from 'crypto';
import type { ErrandType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../cache/cache.service';
import { SanctumAuthGuard } from '../../common/auth/auth.guard';
import { ActiveGuard } from '../../common/auth/active.guard';
import { dec, iso } from '../../common/serialization';

/** Raw ErrandType array shape returned by GET /errand-types (money as strings). */
function rawErrandType(e: ErrandType): Record<string, unknown> {
  return {
    id: e.id,
    slug: e.slug,
    name: e.name,
    description: e.description,
    icon_name: e.iconName,
    base_fee: dec(e.baseFee),
    per_km_walk: dec(e.perKmWalk),
    per_km_bicycle: dec(e.perKmBicycle),
    per_km_motorcycle: dec(e.perKmMotorcycle),
    per_km_car: dec(e.perKmCar),
    surcharge: dec(e.surcharge),
    min_negotiate_fee: dec(e.minNegotiateFee),
    is_active: e.isActive,
    sort_order: e.sortOrder,
    created_at: iso(e.createdAt),
  };
}

@Controller()
export class CatalogController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  /** GET /api/v1/errand-types — public, stale-while-revalidate (soft 1h / hard 24h). */
  @Get('errand-types')
  async errandTypes(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ data: unknown } | undefined> {
    const data = await this.cache.swr('errand_types:active', 3600, 86400, async () => {
      const rows = await this.prisma.errandType.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
      });
      return rows.map(rawErrandType);
    });
    const body = { data };
    // Public reference catalog — make it edge/browser-cacheable with a content
    // ETag so repeat callers get cheap 304s instead of the full body. A short
    // edge max-age (5min) keeps admin catalog-edit propagation quick despite the
    // ~1h server SWR; stale-while-revalidate lets stale copies serve instantly
    // while revalidating. (P22)
    const etag = `"${createHash('sha1').update(JSON.stringify(body)).digest('base64')}"`;
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=86400');
    res.setHeader('ETag', etag);
    if (req.headers['if-none-match'] === etag) {
      res.status(304);
      return undefined;
    }
    return body;
  }

  /** GET /api/v1/config/app — authenticated; {key: value} map of system_config. */
  @Get('config/app')
  @UseGuards(SanctumAuthGuard, ActiveGuard)
  async appConfig(): Promise<{ data: Record<string, string> }> {
    const data = await this.cache.rememberStatic('app_config', async () => {
      const rows = await this.prisma.systemConfig.findMany();
      const out: Record<string, string> = {};
      for (const r of rows) out[r.key] = r.value;
      return out;
    });
    return { data };
  }
}
