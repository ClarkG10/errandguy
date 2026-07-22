import { HttpException, HttpStatus, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * The shape half of LimitRequestSize: rejects pathologically wide/deep JSON
 * (depth > 8, or any object/array level with > 256 entries) with 400.
 *
 * The byte-size cap (1 MiB JSON) and malformed-JSON 400 are enforced by the
 * body-parser limit configured in main.ts + AllExceptionsFilter mapping
 * (entity.too.large → 413, entity.parse.failed → 400).
 */
@Injectable()
export class LimitRequestShapeMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    if (req.body && typeof req.body === 'object' && this.exceedsShape(req.body, 0)) {
      throw new HttpException(
        { message: 'Malformed JSON payload.' },
        HttpStatus.BAD_REQUEST,
      );
    }
    next();
  }

  private exceedsShape(data: unknown, depth: number): boolean {
    if (depth > 8) return true;
    if (Array.isArray(data)) {
      if (data.length > 256) return true;
      return data.some((v) => v && typeof v === 'object' && this.exceedsShape(v, depth + 1));
    }
    if (data && typeof data === 'object') {
      const values = Object.values(data as Record<string, unknown>);
      if (values.length > 256) return true;
      return values.some((v) => v && typeof v === 'object' && this.exceedsShape(v, depth + 1));
    }
    return false;
  }
}
