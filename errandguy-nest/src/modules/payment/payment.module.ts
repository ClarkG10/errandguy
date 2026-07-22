import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { PaymentService } from './payment.service';
import { SystemConfigService } from './system-config.service';
import { PaymentMethodCatalog } from './payment-method-catalog';
import { PaymentMethodController } from './payment-method.controller';
import { PaymentHistoryController } from './payment-history.controller';
import { PaymentStatusController } from './payment-status.controller';
import { XenditWebhookController } from './webhook.controller';

@Module({
  imports: [WalletModule],
  controllers: [
    PaymentMethodController,
    PaymentHistoryController,
    PaymentStatusController,
    XenditWebhookController,
  ],
  providers: [PaymentService, SystemConfigService, PaymentMethodCatalog],
  exports: [PaymentService, SystemConfigService, PaymentMethodCatalog],
})
export class PaymentModule {}
