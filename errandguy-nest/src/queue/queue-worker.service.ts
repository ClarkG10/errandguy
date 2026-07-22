import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Prisma, QueuedJob } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from './queue.service';
import type { QueueConfig } from '../config/configuration';

/**
 * Polls `queued_jobs` and runs due jobs. Reservation uses
 * `FOR UPDATE SKIP LOCKED` so multiple app instances can share the queue
 * safely. Transient failures retry with linear backoff up to max_attempts;
 * exhausted jobs are marked `failed` with the last error.
 */
@Injectable()
export class QueueWorkerService implements OnModuleInit {
  private readonly logger = new Logger('QueueWorker');
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly config: ConfigService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const cfg = this.config.get<QueueConfig>('queue')!;
    if (!cfg.enabled) {
      this.logger.warn('Queue worker disabled (QUEUE_ENABLED=false)');
      return;
    }
    const interval = setInterval(() => void this.tick(), cfg.pollMs);
    this.scheduler.addInterval('queue-worker', interval);
  }

  private async tick(): Promise<void> {
    if (this.running) return; // avoid overlap
    this.running = true;
    try {
      const jobs = await this.reserve(10);
      for (const job of jobs) {
        await this.process(job);
      }
    } catch (e) {
      this.logger.error(`Queue tick failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Atomically claim up to `limit` due jobs. */
  private async reserve(limit: number): Promise<QueuedJob[]> {
    return this.prisma.$queryRaw<QueuedJob[]>(Prisma.sql`
      UPDATE queued_jobs SET reserved_at = NOW(), status = 'reserved', updated_at = NOW()
      WHERE id IN (
        SELECT id FROM queued_jobs
        WHERE status = 'pending' AND reserved_at IS NULL AND available_at <= NOW()
        ORDER BY available_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `);
  }

  private async process(job: QueuedJob): Promise<void> {
    const handler = this.queue.getHandler(job.name);
    if (!handler) {
      this.logger.error(`No handler registered for job "${job.name}" (id=${job.id})`);
      await this.fail(job, 'No handler registered');
      return;
    }
    try {
      await handler((job.payload as Record<string, unknown>) ?? {});
      await this.prisma.queuedJob.delete({ where: { id: job.id } });
    } catch (e) {
      const attempts = job.attempts + 1;
      const message = (e as Error).message;
      if (attempts >= job.maxAttempts) {
        await this.fail(job, message, attempts);
        this.logger.error(`Job "${job.name}" (id=${job.id}) failed permanently: ${message}`);
      } else {
        // Linear backoff: attempts * 30s.
        await this.prisma.queuedJob.update({
          where: { id: job.id },
          data: {
            status: 'pending',
            reservedAt: null,
            attempts,
            lastError: message,
            availableAt: new Date(Date.now() + attempts * 30_000),
          },
        });
        this.logger.warn(`Job "${job.name}" (id=${job.id}) retry ${attempts}/${job.maxAttempts}: ${message}`);
      }
    }
  }

  private async fail(job: QueuedJob, error: string, attempts = job.attempts): Promise<void> {
    await this.prisma.queuedJob
      .update({ where: { id: job.id }, data: { status: 'failed', lastError: error, attempts, reservedAt: null } })
      .catch(() => undefined);
  }
}
