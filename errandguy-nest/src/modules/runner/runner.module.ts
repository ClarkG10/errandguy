import { Module } from '@nestjs/common';
import { BookingModule } from '../booking/booking.module';
import { WalletModule } from '../wallet/wallet.module';
import { PaymentModule } from '../payment/payment.module';
import { RunnerService } from './runner.service';
import { RunnerProfileController } from './runner-profile.controller';
import { RunnerDocumentController } from './runner-document.controller';
import { RunnerOnlineController } from './runner-online.controller';
import { RunnerLocationController } from './runner-location.controller';
import { RunnerErrandController } from './runner-errand.controller';
import { RunnerEarningsController } from './runner-earnings.controller';
import { RunnerPayoutController } from './runner-payout.controller';
import { RunnerHeatmapController } from './runner-heatmap.controller';

@Module({
  imports: [BookingModule, WalletModule, PaymentModule],
  controllers: [
    RunnerProfileController,
    RunnerDocumentController,
    RunnerOnlineController,
    RunnerLocationController,
    RunnerErrandController,
    RunnerEarningsController,
    RunnerPayoutController,
    RunnerHeatmapController,
  ],
  providers: [RunnerService],
})
export class RunnerModule {}
