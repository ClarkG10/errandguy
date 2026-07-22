import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { SanctumService } from './sanctum.service';

/**
 * Equivalent of Laravel's `auth:sanctum` middleware. Resolves the bearer token
 * to a principal and attaches it to the request. On failure returns Sanctum's
 * 401 body: `{"message":"Unauthenticated."}`.
 */
@Injectable()
export class SanctumAuthGuard implements CanActivate {
  constructor(private readonly sanctum: SanctumService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const principal = await this.authenticate(req);
    if (!principal) {
      throw new HttpException({ message: 'Unauthenticated.' }, HttpStatus.UNAUTHORIZED);
    }
    return true;
  }

  protected async authenticate(req: Request): Promise<boolean> {
    const header = req.headers['authorization'];
    if (!header || Array.isArray(header) || !header.startsWith('Bearer ')) return false;
    const bearer = header.slice(7).trim();
    if (!bearer) return false;

    const principal = await this.sanctum.resolve(bearer);
    if (!principal) return false;

    req.principalType = principal.type;
    req.tokenId = principal.tokenId;
    req.user = principal.type === 'user' ? principal.user : principal.admin;
    return true;
  }
}

/**
 * Resolves the principal if a valid bearer is present, but never rejects.
 * Used by public endpoints whose response varies by `request.user()` presence.
 */
@Injectable()
export class OptionalAuthGuard extends SanctumAuthGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    await this.authenticate(req);
    return true;
  }
}
