import { Module } from '@nestjs/common';
import { CustomerSosController } from './customer-sos.controller';
import { RunnerSosController } from './runner-sos.controller';
import { TripShareController } from './trip-share.controller';
import { PublicTripController } from './public-trip.controller';
import { SOSService } from './sos.service';

/**
 * Safety module — customer & runner SOS trigger/deactivate, customer trip-share
 * link management, and the public token-based live trip view.
 *
 * PrismaService, NotificationService/RealtimeService (MessagingModule), the auth
 * guards (AuthCommonModule) and ConfigService are all provided globally, so no
 * imports are required here.
 */
@Module({
  controllers: [
    CustomerSosController,
    RunnerSosController,
    TripShareController,
    PublicTripController,
  ],
  providers: [SOSService],
})
export class SafetyModule {}
