import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';

/**
 * Global error boundary. Reproduces Laravel's JSON error conventions:
 *  - HttpException bodies pass through verbatim (guards/validation already
 *    shaped them as {message} / {success,message} / {message,errors}).
 *  - A bare string HttpException message becomes {message}.
 *  - Prisma "not found" → 404 {message}; everything else → 500 {message}.
 * All 5xx are logged (mirrors the reportable() hook in bootstrap/app.php).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: Record<string, unknown> = { message: 'Server Error' };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();
      if (typeof response === 'string') {
        body = { message: response };
      } else if (response && typeof response === 'object') {
        const r = response as Record<string, unknown>;
        // Nest's default {statusCode,message,error} → normalise to {message}.
        if ('message' in r && !('errors' in r) && !('success' in r) && 'statusCode' in r) {
          const m = r.message;
          body = { message: Array.isArray(m) ? (m[0] as string) : (m as string) };
        } else {
          body = r;
        }
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        body = { message: 'Not found.' };
      } else {
        status = HttpStatus.INTERNAL_SERVER_ERROR;
        body = { message: 'Server Error' };
      }
    }

    if (status >= 500) {
      this.logger.error('Unhandled exception', {
        exception: (exception as Error)?.constructor?.name,
        message: (exception as Error)?.message,
        stack: (exception as Error)?.stack,
        url: req?.originalUrl,
        method: req?.method,
        userId: (req?.user as { id?: string } | undefined)?.id,
      } as unknown as string);
    }

    res.status(status).json(body);
  }
}
