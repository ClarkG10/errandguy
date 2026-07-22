import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from './push.service';

/**
 * Port of NotificationService. Persists the in-app notification FIRST (so it
 * reaches the app over Supabase realtime even without a push token), then makes
 * a best-effort remote push.
 */
@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  async sendPush(
    userId: string,
    title: string,
    body: string,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;

    await this.prisma.notification.create({
      data: {
        userId,
        title,
        body,
        type: (data['type'] as string) ?? 'system',
        data: data as Prisma.InputJsonValue,
        isRead: false,
      },
    });

    const token = user.fcmToken;
    if (!token) return;
    await this.push.send(token, title, body, data);
  }

  async sendBulkPush(
    userIds: string[],
    title: string,
    body: string,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    for (const userId of userIds) {
      await this.sendPush(userId, title, body, data);
    }
  }

  async sendToTopic(
    topic: string,
    title: string,
    body: string,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    await this.push.sendToTopic(topic, title, body, data);
  }
}
