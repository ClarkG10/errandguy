import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import type { AuthConfig } from '../../config/configuration';

/** Reproduces Laravel `Hash::make` / `Hash::check` (bcrypt). */
@Injectable()
export class HashService {
  constructor(private readonly config: ConfigService) {}

  make(plain: string): string {
    const rounds = this.config.get<AuthConfig>('auth')!.bcryptRounds;
    return bcrypt.hashSync(plain, rounds);
  }

  check(plain: string, hashed: string | null | undefined): boolean {
    if (!hashed) return false;
    // PHP emits `$2y$`; bcryptjs speaks `$2a$/$2b$`. They are the same algorithm,
    // so normalise the prefix before comparing hashes minted by the Laravel app.
    const normalized = hashed.startsWith('$2y$') ? '$2b$' + hashed.slice(4) : hashed;
    try {
      return bcrypt.compareSync(plain, normalized);
    } catch {
      return false;
    }
  }
}
