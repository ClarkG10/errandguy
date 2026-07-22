import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthConfig } from '../../config/configuration';
import type { AuthPrincipal } from './principal';

/**
 * Laravel Sanctum-compatible token service.
 *
 * A plaintext bearer is `"{tokenId}|{random}"`; the DB stores `sha256(random)`
 * in `personal_access_tokens.token`. This reproduces that exactly so tokens
 * minted by the old Laravel app keep authenticating, and tokens minted here are
 * readable by anything still speaking Sanctum.
 */
@Injectable()
export class SanctumService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get authCfg(): AuthConfig {
    return this.config.get<AuthConfig>('auth')!;
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  /**
   * Mint a new token for a tokenable. Returns the plaintext bearer the client
   * must send back verbatim. `tokenableType` is the Laravel morph class string.
   */
  async createToken(
    tokenableType: string,
    tokenableId: string,
    name: string,
    abilities: string[] = ['*'],
  ): Promise<{ plainTextToken: string; tokenId: bigint }> {
    const prefix = this.authCfg.tokenPrefix ?? '';
    const random = prefix + randomBytes(30).toString('base64url').slice(0, 40);
    const now = new Date();
    const row = await this.prisma.personalAccessToken.create({
      data: {
        tokenableType,
        tokenableId,
        name,
        token: this.sha256(random),
        abilities: JSON.stringify(abilities),
        createdAt: now,
        updatedAt: now,
      },
    });
    return { plainTextToken: `${row.id.toString()}|${random}`, tokenId: row.id };
  }

  /** Resolve a bearer string to a principal, or null if invalid/expired. */
  async resolve(bearer: string): Promise<AuthPrincipal | null> {
    const pipe = bearer.indexOf('|');
    if (pipe < 1) return null;
    const idPart = bearer.slice(0, pipe);
    const random = bearer.slice(pipe + 1);
    let tokenId: bigint;
    try {
      tokenId = BigInt(idPart);
    } catch {
      return null;
    }

    const row = await this.prisma.personalAccessToken.findUnique({ where: { id: tokenId } });
    if (!row) return null;

    // Constant-time compare of sha256(random) against the stored hash.
    const expected = Buffer.from(row.token);
    const actual = Buffer.from(this.sha256(random));
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

    if (!this.tokenIsValid(row.createdAt, row.expiresAt)) return null;

    const cfg = this.authCfg;
    if (row.tokenableType === cfg.tokenableUserType) {
      const user = await this.prisma.user.findFirst({
        where: { id: row.tokenableId, deletedAt: null },
      });
      if (!user) return null;
      this.touchLastUsed(tokenId);
      return { type: 'user', tokenId, user };
    }
    if (row.tokenableType === cfg.tokenableAdminType) {
      const admin = await this.prisma.adminUser.findUnique({ where: { id: row.tokenableId } });
      if (!admin) return null;
      this.touchLastUsed(tokenId);
      return { type: 'admin', tokenId, admin };
    }
    return null;
  }

  /** Sanctum validity: config-expiration relative to created_at AND expires_at column. */
  private tokenIsValid(createdAt: Date | null, expiresAt: Date | null): boolean {
    const exp = this.authCfg.expirationMinutes;
    const now = Date.now();
    if (exp !== null && createdAt) {
      if (createdAt.getTime() <= now - exp * 60_000) return false;
    }
    if (expiresAt && expiresAt.getTime() <= now) return false;
    return true;
  }

  /** Best-effort last_used_at bump (Sanctum does this per request; not awaited). */
  private touchLastUsed(tokenId: bigint): void {
    this.prisma.personalAccessToken
      .update({ where: { id: tokenId }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
  }

  /** Delete the exact token behind the current request (logout). */
  async deleteToken(tokenId: bigint): Promise<void> {
    await this.prisma.personalAccessToken.delete({ where: { id: tokenId } }).catch(() => undefined);
  }

  /** Delete a tokenable's tokens by device name (login same-device revoke). */
  async deleteTokensByName(
    tokenableType: string,
    tokenableId: string,
    name: string,
  ): Promise<void> {
    await this.prisma.personalAccessToken.deleteMany({
      where: { tokenableType, tokenableId, name },
    });
  }

  /** Delete ALL of a tokenable's tokens (password reset). */
  async deleteAllTokens(tokenableType: string, tokenableId: string): Promise<void> {
    await this.prisma.personalAccessToken.deleteMany({ where: { tokenableType, tokenableId } });
  }
}
