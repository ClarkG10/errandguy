import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';

/**
 * On authenticated responses, add `Cache-Control: no-store, private` + `Pragma`
 * (unless already set), mirroring SecurityHeaders' user-scoped branch.
 */
@Injectable()
export class CacheControlInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    return next.handle().pipe(
      tap(() => {
        if (req.user && !res.getHeader('Cache-Control')) {
          res.setHeader('Cache-Control', 'no-store, private');
          res.setHeader('Pragma', 'no-cache');
        }
      }),
    );
  }
}
