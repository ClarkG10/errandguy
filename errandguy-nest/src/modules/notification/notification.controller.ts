import {
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Notification, User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SanctumAuthGuard } from '../../common/auth/auth.guard';
import { ActiveGuard } from '../../common/auth/active.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { iso } from '../../common/serialization';
import { paginate, pageParams } from '../../common/pagination';
import type { AppConfig } from '../../config/configuration';

/** Mirrors NotificationResource (archived_at omitted). */
function notificationResource(n: Notification): Record<string, unknown> {
  return {
    id: n.id,
    user_id: n.userId,
    title: n.title,
    body: n.body,
    type: n.type,
    data: n.data,
    is_read: n.isRead,
    created_at: iso(n.createdAt),
  };
}

@Controller('notifications')
@UseGuards(SanctumAuthGuard, ActiveGuard)
export class NotificationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private path(): string {
    const app = this.config.get<AppConfig>('app')!;
    return `${app.url.replace(/\/+$/, '')}/${app.apiPrefix}/notifications`;
  }

  @Get()
  async index(
    @CurrentUser() user: User,
    @Query() query: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const { page, perPage } = pageParams(query, 20);
    const archived = query.archived === '1' || query.archived === 'true';
    const where = {
      userId: user.id,
      ...(archived ? { archivedAt: { not: null } } : { archivedAt: null }),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.notification.count({ where }),
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
    ]);
    return paginate(rows.map(notificationResource), total, page, perPage, this.path());
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: User): Promise<Record<string, unknown>> {
    const count = await this.prisma.notification.count({
      where: { userId: user.id, isRead: false },
    });
    return { data: { unread_count: count } };
  }

  @Put('read-all')
  async markAllAsRead(@CurrentUser() user: User): Promise<{ message: string }> {
    await this.prisma.notification.updateMany({
      where: { userId: user.id, isRead: false },
      data: { isRead: true },
    });
    return { message: 'All notifications marked as read.' };
  }

  @Put(':id/read')
  async markAsRead(@CurrentUser() user: User, @Param('id') id: string): Promise<{ message: string }> {
    await this.owned(user.id, id);
    await this.prisma.notification.update({ where: { id }, data: { isRead: true } });
    return { message: 'Notification marked as read.' };
  }

  @Put(':id/archive')
  async archive(@CurrentUser() user: User, @Param('id') id: string): Promise<{ message: string }> {
    await this.owned(user.id, id);
    await this.prisma.notification.update({ where: { id }, data: { archivedAt: new Date() } });
    return { message: 'Notification archived.' };
  }

  @Put(':id/unarchive')
  async unarchive(@CurrentUser() user: User, @Param('id') id: string): Promise<{ message: string }> {
    await this.owned(user.id, id);
    await this.prisma.notification.update({ where: { id }, data: { archivedAt: null } });
    return { message: 'Notification unarchived.' };
  }

  @Delete()
  async clearAll(@CurrentUser() user: User): Promise<Record<string, unknown>> {
    const { count } = await this.prisma.notification.deleteMany({ where: { userId: user.id } });
    return { message: 'Notifications cleared.', data: { deleted_count: count } };
  }

  @Delete(':id')
  async destroy(@CurrentUser() user: User, @Param('id') id: string): Promise<{ message: string }> {
    await this.owned(user.id, id);
    await this.prisma.notification.delete({ where: { id } });
    return { message: 'Notification deleted.' };
  }

  private async owned(userId: string, id: string): Promise<void> {
    const n = await this.prisma.notification.findFirst({ where: { id, userId }, select: { id: true } });
    if (!n) throw new HttpException({ message: 'Not found.' }, HttpStatus.NOT_FOUND);
  }
}
