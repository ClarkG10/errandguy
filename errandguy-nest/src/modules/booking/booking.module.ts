import { Module } from '@nestjs/common';
import { ReferralModule } from '../referral/referral.module';
import { PromoModule } from '../promo/promo.module';
import { PaymentModule } from '../payment/payment.module';
import { WalletModule } from '../wallet/wallet.module';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';
import { PricingService } from './pricing.service';
import { MatchingService } from './matching.service';
import { LocationService } from './location.service';
import { BookingListeners } from './booking.listeners';
import { BookingMaintenanceService } from './booking-maintenance.service';

@Module({
  imports: [ReferralModule, PromoModule, PaymentModule, WalletModule],
  controllers: [BookingController],
  providers: [BookingService, PricingService, MatchingService, LocationService, BookingListeners, BookingMaintenanceService],
  exports: [BookingService, PricingService, MatchingService, LocationService],
})
export class BookingModule {}
