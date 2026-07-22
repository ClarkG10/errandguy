import { Module } from '@nestjs/common';
import { PaymentModule } from '../payment/payment.module';
import { AdminAuthController } from './admin-auth.controller';
import { AdminController } from './admin.controller';

@Module({
  imports: [PaymentModule],
  controllers: [AdminAuthController, AdminController],
})
export class AdminModule {}
