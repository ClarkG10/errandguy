import { Module } from '@nestjs/common';
import { ReferralModule } from '../referral/referral.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';

@Module({
  imports: [ReferralModule],
  controllers: [AuthController],
  providers: [AuthService, OtpService],
})
export class AuthModule {}
