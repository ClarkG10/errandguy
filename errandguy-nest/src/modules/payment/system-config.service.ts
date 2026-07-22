import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../cache/cache.service';

/** Port of SystemConfig::getValue/setValue (cache-backed, 1h). */
@Injectable()
export class SystemConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async getValue(key: string, fallback: string | null = null): Promise<string | null> {
    return this.cache.remember(
      `system_config:${key}`,
      async () => {
        const row = await this.prisma.systemConfig.findUnique({ where: { key } });
        return row?.value ?? fallback;
      },
      3600,
    );
  }

  async setValue(key: string, value: string, updatedBy: string | null = null): Promise<void> {
    await this.prisma.systemConfig.upsert({
      where: { key },
      update: { value, updatedBy, updatedAt: new Date() },
      create: { key, value, updatedBy, updatedAt: new Date() },
    });
    this.cache.forget(`system_config:${key}`);
    this.cache.forget('app_config');
  }
}
