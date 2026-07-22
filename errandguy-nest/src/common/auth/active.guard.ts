import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Equivalent of the `active` middleware (EnsureUserActive). Blocks
 * suspended/banned/deleted accounts and throttles the `last_active_at` write to
 * once per 60s per user (in-memory NX lock — matches Laravel's Cache::add).
 */
@Injectable()
export class ActiveGuard implements CanActivate {
  private static readonly presence = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const user = req.user as User | undefined;

    if (!user) {
      throw new HttpException(
        { success: false, message: 'Unauthenticated.' },
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (user.status === 'suspended') {
      throw new HttpException(
        { success: false, message: 'Your account has been suspended. Please contact support.' },
        HttpStatus.FORBIDDEN,
      );
    }
    if (user.status === 'banned') {
      throw new HttpException(
        { success: false, message: 'Your account has been permanently banned.' },
        HttpStatus.FORBIDDEN,
      );
    }
    if (user.status === 'deleted') {
      throw new HttpException(
        { success: false, message: 'This account no longer exists.' },
        HttpStatus.FORBIDDEN,
      );
    }

    this.touchPresence(user.id);
    return true;
  }

  private touchPresence(userId: string): void {
    const now = Date.now();
    const until = ActiveGuard.presence.get(userId) ?? 0;
    if (now < until) return;
    ActiveGuard.presence.set(userId, now + 60_000);
    // Targeted UPDATE that does NOT bump updated_at (mirrors Laravel's raw
    // whereKey()->update() which bypasses timestamps/observers).
    this.prisma
      .$executeRaw`UPDATE users SET last_active_at = NOW() WHERE id = ${userId}::uuid`.catch(
      () => undefined,
    );
  }
}
