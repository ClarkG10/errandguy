import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import type { IntegrationsConfig } from '../config/configuration';

/**
 * Transactional email via Resend (replaces resend-laravel). Equivalent of
 * Laravel's `Mail::raw($body, subject)`. Throws on failure so callers can map
 * to the same 502/503 the Laravel controllers returned.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger('Mail');

  constructor(private readonly config: ConfigService) {}

  private get cfg(): IntegrationsConfig['resend'] {
    return this.config.get<IntegrationsConfig>('integrations')!.resend;
  }

  /** Send a plain-text email. Mirrors Mail::raw. */
  async raw(to: string, subject: string, text: string): Promise<void> {
    const { apiKey, fromAddress, fromName } = this.cfg;
    if (!apiKey) {
      // In local/dev without a key, log instead of failing (parity with the
      // OTP SMS dev stub) so flows remain testable.
      this.logger.warn(`[dev mail] to=${to} subject="${subject}"\n${text}`);
      return;
    }
    await axios.post(
      'https://api.resend.com/emails',
      { from: `${fromName} <${fromAddress}>`, to: [to], subject, text },
      { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 15_000 },
    );
  }
}
