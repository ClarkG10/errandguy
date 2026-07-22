import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SanctumAuthGuard } from '../../common/auth/auth.guard';
import { CurrentTokenId } from '../../common/auth/current-user.decorator';
import { AuthThrottle, OtpThrottle } from '../../common/throttling/throttle.decorators';
import { AuthService } from './auth.service';
import {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  SendOtpDto,
  SocialLoginDto,
  VerifyOtpDto,
} from './dto/auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @AuthThrottle()
  register(@Body() dto: RegisterDto, @Headers('user-agent') ua?: string) {
    return this.auth.register(dto, ua ?? 'mobile');
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @AuthThrottle()
  login(@Body() dto: LoginDto, @Headers('user-agent') ua?: string) {
    return this.auth.login(dto, ua ?? 'mobile');
  }

  @Post('send-otp')
  @HttpCode(HttpStatus.OK)
  @OtpThrottle()
  sendOtp(@Body() dto: SendOtpDto) {
    return this.auth.sendOtp(dto.phone, dto.email);
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @AuthThrottle()
  verifyOtp(@Body() dto: VerifyOtpDto, @Headers('user-agent') ua?: string) {
    return this.auth.verifyOtp(dto, ua ?? 'mobile');
  }

  @Post('social-login')
  @HttpCode(HttpStatus.OK)
  @AuthThrottle()
  socialLogin(@Body() dto: SocialLoginDto, @Headers('user-agent') ua?: string) {
    return this.auth.socialLogin(dto, ua ?? 'mobile');
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @AuthThrottle()
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @AuthThrottle()
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SanctumAuthGuard)
  logout(@CurrentTokenId() tokenId: bigint) {
    return this.auth.logout(tokenId);
  }
}
