import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { AdminUser } from '@prisma/client';

/**
 * Equivalent of the `admin` middleware (EnsureAdminUser). Requires the principal
 * to be an AdminUser (not a regular User with a valid token) AND active.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (req.principalType !== 'admin' || !req.user) {
      throw new HttpException(
        { success: false, message: 'Unauthorized. Admin access required.' },
        HttpStatus.FORBIDDEN,
      );
    }
    if (!(req.user as AdminUser).isActive) {
      throw new HttpException(
        { success: false, message: 'Admin account is deactivated.' },
        HttpStatus.FORBIDDEN,
      );
    }
    return true;
  }
}
