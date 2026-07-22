import { Throttle } from '@nestjs/throttler';

/** `throttle:auth` — 5 attempts / 15 minutes (keyed by credential). */
export const AuthThrottle = () => Throttle({ default: { limit: 5, ttl: 900_000 } });

/** `throttle:otp` — 3 / hour (keyed by credential). */
export const OtpThrottle = () => Throttle({ default: { limit: 3, ttl: 3_600_000 } });

/** `throttle:{limit},{minutes}` — generic per-route override. */
export const RouteThrottle = (limit: number, minutes: number) =>
  Throttle({ default: { limit, ttl: minutes * 60_000 } });
