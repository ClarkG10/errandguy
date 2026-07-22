import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AdminUser, User } from '@prisma/client';

/** Injects the authenticated User (tokenable). Undefined on public routes. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): User | undefined => {
    const req = ctx.switchToHttp().getRequest<Request>();
    return req.principalType === 'user' ? (req.user as User) : undefined;
  },
);

/** Injects the authenticated AdminUser. Undefined unless an admin token. */
export const CurrentAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AdminUser | undefined => {
    const req = ctx.switchToHttp().getRequest<Request>();
    return req.principalType === 'admin' ? (req.user as AdminUser) : undefined;
  },
);

/** Injects the personal_access_tokens row id behind the request. */
export const CurrentTokenId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): bigint | undefined => {
    return ctx.switchToHttp().getRequest<Request>().tokenId;
  },
);
