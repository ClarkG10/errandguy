import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type JobHandler = (payload: Record<string, unknown>) => Promise<void>;

/**
 * DB-backed job queue (replaces Laravel's `database` queue driver). Feature
 * modules register a handler per job name and enqueue work with an optional
 * delay; QueueWorker drains due jobs. No Redis required.
 */
@Injectable()
export class QueueService {
  private readonly logger = new Logger('Queue');
  private readonly handlers = new Map<string, JobHandler>();

  constructor(private readonly prisma: PrismaService) {}

  registerHandler(name: string, handler: JobHandler): void {
    if (this.handlers.has(name)) {
      this.logger.warn(`Overwriting existing handler for job "${name}"`);
    }
    this.handlers.set(name, handler);
  }

  getHandler(name: string): JobHandler | undefined {
    return this.handlers.get(name);
  }

  /** Enqueue a job to run after `delayMs` (0 = as soon as the worker polls). */
  async enqueue(
    name: string,
    payload: Record<string, unknown> = {},
    delayMs = 0,
    maxAttempts = 3,
  ): Promise<string> {
    const job = await this.prisma.queuedJob.create({
      data: {
        name,
        payload: payload as Prisma.InputJsonValue,
        availableAt: new Date(Date.now() + Math.max(0, delayMs)),
        maxAttempts,
        status: 'pending',
      },
    });
    return job.id;
  }
}
