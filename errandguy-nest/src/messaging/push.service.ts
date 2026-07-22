import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as admin from 'firebase-admin';
import type { IntegrationsConfig } from '../config/configuration';

/**
 * Remote push delivery. FCM via firebase-admin (replaces kreait), Expo push via
 * the exp.host HTTP API. All sends are best-effort — failures are logged, never
 * thrown (mirrors NotificationService's private senders).
 */
@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger('Push');
  private messaging: admin.messaging.Messaging | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const fb = this.config.get<IntegrationsConfig>('integrations')!.firebase;
    if (!fb.credentials) {
      this.logger.warn('FIREBASE_CREDENTIALS not set — FCM disabled (Expo push still works).');
      return;
    }
    try {
      let credential: admin.credential.Credential;
      const trimmed = fb.credentials.trim();
      if (trimmed.startsWith('{')) {
        credential = admin.credential.cert(JSON.parse(trimmed) as admin.ServiceAccount);
      } else {
        // Path to the service-account JSON on disk.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        credential = admin.credential.cert(require(trimmed) as admin.ServiceAccount);
      }
      const app = admin.apps.length
        ? admin.app()
        : admin.initializeApp({ credential, projectId: fb.projectId || undefined });
      this.messaging = app.messaging();
    } catch (e) {
      this.logger.error(`Firebase init failed: ${(e as Error).message}`);
    }
  }

  /** Route by token shape, exactly like NotificationService::sendPush. */
  async send(token: string, title: string, body: string, data: Record<string, unknown>): Promise<void> {
    if (token.startsWith('ExponentPushToken')) {
      await this.sendExpo(token, title, body, data);
    } else {
      await this.sendFcm(token, title, body, data);
    }
  }

  async sendToTopic(topic: string, title: string, body: string, data: Record<string, unknown>): Promise<void> {
    if (!this.messaging) return;
    try {
      await this.messaging.send({ topic, notification: { title, body }, data: this.stringifyData(data) });
    } catch (e) {
      this.logger.error(`FCM topic push failed: ${(e as Error).message}`);
    }
  }

  private async sendExpo(token: string, title: string, body: string, data: Record<string, unknown>): Promise<void> {
    try {
      await axios.post(
        'https://exp.host/--/api/v2/push/send',
        { to: token, title, body, data, sound: 'default', priority: 'high', channelId: 'default' },
        { timeout: 10_000 },
      );
    } catch (e) {
      this.logger.error(`Expo push failed: ${(e as Error).message}`);
    }
  }

  private async sendFcm(token: string, title: string, body: string, data: Record<string, unknown>): Promise<void> {
    if (!this.messaging) return;
    try {
      await this.messaging.send({ token, notification: { title, body }, data: this.stringifyData(data) });
    } catch (e) {
      this.logger.error(`FCM push failed: ${(e as Error).message}`);
    }
  }

  /** FCM data values must be strings. */
  private stringifyData(data: Record<string, unknown>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(data ?? {})) {
      out[k] = typeof v === 'string' ? v : JSON.stringify(v);
    }
    return out;
  }
}
