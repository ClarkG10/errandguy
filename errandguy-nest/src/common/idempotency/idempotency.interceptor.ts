import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { createHash } from 'crypto';
import { Observable, firstValueFrom, from } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';
import { IDEMPOTENT_KEY } from './idempotent.decorator';

/**
 * Durable idempotency for money-mutation routes. A replay of the same attempt
 * returns the same stored outcome; a same-key-different-body replay 422s; an
 * in-flight replay 409s. Mirrors EnsureIdempotency exactly:
 *   - no key → soft pass-through (+warning)
 *   - completed + hash match → replay stored body/code
 *   - completed + hash mismatch → 422
 *   - in-flight → 409
 *   - new → claim (unique row), run, store 2xx/4xx JSON; release on 5xx/throw.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Idempotency');

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.getAllAndOverride<{ successStatus: number } | undefined>(
      IDEMPOTENT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!meta) return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    return from(this.run(req, res, next, meta.successStatus));
  }

  private normalizedPath(req: Request): string {
    // Laravel request->path(): no leading slash, no query string.
    return (req.baseUrl + req.path).replace(/^\/+/, '') || req.path.replace(/^\/+/, '');
  }

  private hash(req: Request): string {
    const payload = `${req.method}|${this.normalizedPath(req)}|${JSON.stringify(req.body ?? {})}`;
    return createHash('sha256').update(payload).digest('hex');
  }

  private async run(
    req: Request,
    res: Response,
    next: CallHandler,
    successStatus: number,
  ): Promise<unknown> {
    const key = req.headers['idempotency-key'];
    if (!key || Array.isArray(key) || key.trim() === '') {
      this.logger.warn(`Idempotency-Key missing on ${this.normalizedPath(req)}`);
      return this.await(next.handle());
    }

    const userId = (req.user as { id?: string } | undefined)?.id ?? null;
    const hash = this.hash(req);

    const existing = await this.prisma.idempotencyKey.findFirst({
      where: { userId, idemKey: key },
    });

    if (existing) {
      if (existing.status === 'completed') {
        if (existing.requestHash !== hash) {
          throw new HttpException(
            { message: 'This Idempotency-Key was already used with a different request.' },
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
        res.status(existing.responseCode ?? 200);
        return existing.responseBody ?? {};
      }
      throw new HttpException(
        { message: 'A payment with this reference is still being processed. Please wait a moment.' },
        HttpStatus.CONFLICT,
      );
    }

    let record;
    try {
      record = await this.prisma.idempotencyKey.create({
        data: {
          userId,
          idemKey: key,
          method: req.method,
          path: this.normalizedPath(req).slice(0, 191),
          requestHash: hash,
          status: 'in_progress',
          lockedAt: new Date(),
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new HttpException(
          {
            message:
              'A payment with this reference is still being processed. Please wait a moment.',
          },
          HttpStatus.CONFLICT,
        );
      }
      throw e;
    }

    try {
      const body = await this.await(next.handle());
      const code = res.statusCode && res.statusCode >= 200 ? res.statusCode : successStatus;
      await this.prisma.idempotencyKey
        .update({
          where: { id: record.id },
          data: { status: 'completed', responseCode: code, responseBody: body as Prisma.InputJsonValue },
        })
        .catch((err) => this.logger.warn(`Failed to persist idempotent response: ${err.message}`));
      return body;
    } catch (err) {
      // A definitive 4xx JSON outcome is replayable; 5xx / non-http release the claim.
      if (err instanceof HttpException) {
        const status = err.getStatus();
        if (status >= 400 && status < 500) {
          await this.prisma.idempotencyKey
            .update({
              where: { id: record.id },
              data: {
                status: 'completed',
                responseCode: status,
                responseBody: err.getResponse() as Prisma.InputJsonValue,
              },
            })
            .catch(() => undefined);
          throw err;
        }
      }
      await this.release(record.id);
      throw err;
    }
  }

  private await<T>(obs: Observable<T>): Promise<T> {
    return firstValueFrom(obs);
  }

  private async release(id: string): Promise<void> {
    await this.prisma.idempotencyKey.delete({ where: { id } }).catch(() => undefined);
  }
}
