import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';

/**
 * Mirrors LogApiRequests: logs each request's method/url/status/duration,
 * skipping the two hot-path pollers (runner/location, chat/unread-count) unless
 * status ≥ 400 or duration > 500ms. Error-status logging is handled centrally in
 * AllExceptionsFilter; this covers the success path.
 */
@Injectable()
export class LogRequestsInterceptor implements NestInterceptor {
  private static readonly SKIP = ['runner/location', 'chat/unread-count'];
  private static readonly SLOW_MS = 500;
  private readonly logger = new Logger('API');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const start = Date.now();

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - start;
        const status = res.statusCode;
        const path = req.path;
        const isHot = LogRequestsInterceptor.SKIP.some((n) => path.includes(n));
        if (isHot && status < 400 && duration <= LogRequestsInterceptor.SLOW_MS) return;
        this.logger.log(
          `${req.method} ${req.originalUrl} ${status} ${duration}ms user=${
            (req.user as { id?: string } | undefined)?.id ?? '-'
          }`,
        );
      }),
    );
  }
}
