import { ThrottlerModuleOptions } from '@nestjs/throttler';
import type { Request } from 'express';

/**
 * Global rate-limit config mirroring bootstrap/app.php.
 *
 * Keying (module-level getTracker, since guards run before auth resolves req.user):
 *  - auth/admin-login routes → by credential (phone/email/phone_or_email) else IP
 *    (Laravel's `auth:{identifier}` bucket).
 *  - other authenticated routes → by the bearer token id (cheap stand-in for the
 *    user id — no DB hit; a user's device tokens bucket separately).
 *  - unauthenticated → by IP.
 *
 * The base limit is 240/min (Laravel's authenticated `api` limit). Per-route
 * overrides (@AuthThrottle / @OtpThrottle / @RouteThrottle) tighten specific
 * surfaces exactly as the Laravel route `throttle:*` declarations did.
 *
 * Known minor deviation: the guest-only 20/min global cap and the secondary
 * 30/15min-per-IP auth cap are not separately modelled; the security-critical
 * per-credential auth (5/15min), otp (3/hr), and per-route caps are preserved.
 */
export function buildThrottlerOptions(): ThrottlerModuleOptions {
  return {
    throttlers: [{ ttl: 60_000, limit: 240 }],
    errorMessage: 'Too many attempts.',
    getTracker: (req: Record<string, any>): string => {
      const r = req as Request;
      const path = (r.originalUrl || r.url || '').split('?')[0];
      if (path.includes('/auth/') || path.endsWith('/admin/login')) {
        const b = (r.body ?? {}) as Record<string, unknown>;
        const cred = b.phone ?? b.email ?? b.phone_or_email ?? r.ip;
        return `cred:${String(cred)}`;
      }
      const auth = r.headers?.['authorization'];
      if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
        return `tok:${auth.slice(7).split('|')[0]}`;
      }
      return `ip:${r.ip}`;
    },
  };
}
