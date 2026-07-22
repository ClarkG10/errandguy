import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

import configuration from './config/configuration';
import { buildThrottlerOptions } from './common/throttling/throttler.config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthCommonModule } from './common/auth/auth-common.module';
import { CacheModule } from './cache/cache.module';
import { MessagingModule } from './messaging/messaging.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { QueueModule } from './queue/queue.module';

import { SecurityHeadersMiddleware } from './common/middleware/security-headers.middleware';
import { LimitRequestShapeMiddleware } from './common/middleware/limit-request-shape.middleware';
import { SanitizeInputMiddleware } from './common/middleware/sanitize-input.middleware';

// Feature modules
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { ReferralModule } from './modules/referral/referral.module';
import { NotificationApiModule } from './modules/notification/notification.module';
import { ChatModule } from './modules/chat/chat.module';
import { PromoModule } from './modules/promo/promo.module';
import { ReviewModule } from './modules/review/review.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { PaymentModule } from './modules/payment/payment.module';
import { BookingModule } from './modules/booking/booking.module';
import { RunnerModule } from './modules/runner/runner.module';
import { SafetyModule } from './modules/safety/safety.module';
import { ShoppingModule } from './modules/shopping/shopping.module';
import { SupportModule } from './modules/support/support.module';
import { AdminModule } from './modules/admin/admin.module';
import { ExportModule } from './modules/export/export.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    ThrottlerModule.forRoot(buildThrottlerOptions()),

    // Foundation (all @Global)
    PrismaModule,
    AuthCommonModule,
    CacheModule,
    MessagingModule,
    IntegrationsModule,
    QueueModule,

    // Features
    CatalogModule,
    ReferralModule,
    AuthModule,
    UserModule,
    NotificationApiModule,
    ChatModule,
    PromoModule,
    ReviewModule,
    WalletModule,
    PaymentModule,
    BookingModule,
    RunnerModule,
    SafetyModule,
    ShoppingModule,
    SupportModule,
    AdminModule,
    ExportModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Order mirrors bootstrap/app.php: security headers, then shape guard,
    // then input sanitization — all before guards/handlers.
    consumer
      .apply(SecurityHeadersMiddleware, LimitRequestShapeMiddleware, SanitizeInputMiddleware)
      .forRoutes('*');
  }
}
