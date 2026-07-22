import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { User } from '@prisma/client';
import { ROLES_KEY } from './roles.decorator';

/**
 * Equivalent of `role:{role}` (RoleMiddleware). 403 with the exact Laravel body
 * when the authenticated user's role does not match.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const user = req.user as User | undefined;
    if (!user || (user as User).role !== required) {
      throw new HttpException(
        { success: false, message: `Unauthorized. This action requires the ${required} role.` },
        HttpStatus.FORBIDDEN,
      );
    }
    return true;
  }
}
