import { Injectable } from '@nestjs/common';

interface Entry {
  value: unknown;
  expiresAt: number; // epoch ms; Infinity = no expiry
}

/**
 * In-memory cache with the same surface as Laravel's CacheService (the Laravel
 * app used the `file` driver — a per-instance store — so an in-memory Map is the
 * faithful equivalent). Includes the stale-while-revalidate helper.
 */
@Injectable()
export class CacheService {
  private static readonly DEFAULT_TTL = 600;
  private static readonly SHORT_TTL = 60;
  private static readonly LONG_TTL = 3600;
  private static readonly STATIC_TTL = 86400;

  private readonly store = new Map<string, Entry>();

  private now(): number {
    return Date.now();
  }

  get<T = unknown>(key: string): T | undefined {
    const e = this.store.get(key);
    if (!e) return undefined;
    if (e.expiresAt !== Infinity && this.now() >= e.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return e.value as T;
  }

  put(key: string, value: unknown, ttlSeconds: number | null): void {
    this.store.set(key, {
      value,
      expiresAt: ttlSeconds === null ? Infinity : this.now() + ttlSeconds * 1000,
    });
  }

  /** Cache::add — set only if absent (NX). Returns true if it set. */
  add(key: string, value: unknown, ttlSeconds: number): boolean {
    if (this.get(key) !== undefined) return false;
    this.put(key, value, ttlSeconds);
    return true;
  }

  forget(key: string): boolean {
    return this.store.delete(key);
  }

  async remember<T>(key: string, callback: () => Promise<T> | T, ttl?: number): Promise<T> {
    const hit = this.get<T>(key);
    if (hit !== undefined) return hit;
    const value = await callback();
    this.put(key, value, ttl ?? CacheService.DEFAULT_TTL);
    return value;
  }

  rememberShort<T>(key: string, cb: () => Promise<T> | T): Promise<T> {
    return this.remember(key, cb, CacheService.SHORT_TTL);
  }

  rememberLong<T>(key: string, cb: () => Promise<T> | T): Promise<T> {
    return this.remember(key, cb, CacheService.LONG_TTL);
  }

  rememberStatic<T>(key: string, cb: () => Promise<T> | T): Promise<T> {
    return this.remember(key, cb, CacheService.STATIC_TTL);
  }

  /**
   * Stale-while-revalidate. Fresh → return cached; stale → return stale now +
   * background-refresh once (deduped by a 30s lock); cold/expired → recompute.
   */
  async swr<T>(key: string, softTtl: number, hardTtl: number, callback: () => Promise<T> | T): Promise<T> {
    const entry = this.get<{ value: T; fresh_until: number }>(key);
    const nowSec = Math.floor(this.now() / 1000);

    if (entry && typeof entry === 'object' && 'value' in entry) {
      const freshUntil = Number(entry.fresh_until ?? 0);
      if (nowSec < freshUntil) return entry.value;

      const lockKey = `${key}:swr-refresh`;
      if (this.add(lockKey, 1, 30)) {
        // Background refresh — does not block the response.
        setImmediate(async () => {
          try {
            const value = await callback();
            this.put(key, { value, fresh_until: Math.floor(this.now() / 1000) + softTtl }, hardTtl);
          } finally {
            this.forget(lockKey);
          }
        });
      }
      return entry.value;
    }

    const value = await callback();
    this.put(key, { value, fresh_until: nowSec + softTtl }, hardTtl);
    return value;
  }

  forgetUser(userId: string): void {
    ['profile', 'addresses', 'contacts', 'wallet', 'notifications:count'].forEach((s) =>
      this.forget(`user:${userId}:${s}`),
    );
  }

  forgetRunner(userId: string): void {
    ['profile', 'earnings', 'current_errand'].forEach((s) => this.forget(`runner:${userId}:${s}`));
  }

  forgetBooking(bookingId: string): void {
    [`booking:${bookingId}`, `booking:${bookingId}:track`, `booking:${bookingId}:messages`].forEach((k) =>
      this.forget(k),
    );
  }

  forgetConfig(): void {
    ['errand_types', 'system_config', 'app_config'].forEach((k) => this.forget(k));
  }

  static userProfileKey(userId: string): string {
    return `user:${userId}:profile`;
  }
  static runnerProfileKey(userId: string): string {
    return `runner:${userId}:profile`;
  }
  static unreadNotificationsKey(userId: string): string {
    return `user:${userId}:notifications:count`;
  }
}
