import { HttpException, HttpStatus, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * Recursively trims + strips control chars from all request-body strings, and
 * 422s any field over 10k chars. Fields in the preserve list (secrets) are left
 * untouched. Mirrors the SanitizeInput middleware.
 */
@Injectable()
export class SanitizeInputMiddleware implements NestMiddleware {
  private static readonly MAX_FIELD_LENGTH = 10_000;
  private static readonly PRESERVE = new Set([
    'password',
    'password_confirmation',
    'current_password',
    'new_password',
    'token',
    'access_token',
    'refresh_token',
    'secret',
  ]);
  // C0 controls (except tab/LF/CR), DEL and C1 range — matches Laravel's
  // /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/u.
  private static readonly CONTROL = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/gu;

  use(req: Request, _res: Response, next: NextFunction): void {
    if (req.body && typeof req.body === 'object') {
      const cleaned = this.sanitize(req.body);
      if (cleaned === null) {
        throw new HttpException(
          { message: 'Input field exceeds maximum allowed length.' },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      req.body = cleaned;
    }
    next();
  }

  private sanitize(data: unknown): unknown | null {
    if (Array.isArray(data)) {
      const out: unknown[] = [];
      for (const v of data) {
        const c = this.sanitize(v);
        if (c === null) return null;
        out.push(c);
      }
      return out;
    }
    if (data && typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(obj)) {
        const value = obj[key];
        if (SanitizeInputMiddleware.PRESERVE.has(key)) {
          out[key] = value;
          continue;
        }
        if (typeof value === 'string') {
          if (value.length > SanitizeInputMiddleware.MAX_FIELD_LENGTH) return null;
          out[key] = value.replace(SanitizeInputMiddleware.CONTROL, '').trim();
        } else if (value && typeof value === 'object') {
          const c = this.sanitize(value);
          if (c === null) return null;
          out[key] = c;
        } else {
          out[key] = value;
        }
      }
      return out;
    }
    return data;
  }
}
