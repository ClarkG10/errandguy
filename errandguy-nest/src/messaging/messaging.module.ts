import { Global, Module } from '@nestjs/common';
import { PushService } from './push.service';
import { NotificationService } from './notification.service';
import { RealtimeService } from './realtime.service';

/** App-wide notification + realtime + push services. */
@Global()
@Module({
  providers: [PushService, NotificationService, RealtimeService],
  exports: [PushService, NotificationService, RealtimeService],
})
export class MessagingModule {}
