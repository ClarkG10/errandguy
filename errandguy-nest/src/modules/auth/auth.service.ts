import { HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { HashService } from '../../common/auth/hash.service';
import { SanctumService } from '../../common/auth/sanctum.service';
import { CacheService } from '../../cache/cache.service';
import { MailService } from '../../integrations/mail.service';
import { LaravelValidationException } from '../../common/exceptions/validation.exception';
import { userResource } from '../../common/resources/user.resource';
import type { AuthConfig } from '../../config/configuration';
import { ReferralService } from '../referral/referral.service';
import { OtpService } from './otp.service';
import {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  SocialLoginDto,
  VerifyOtpDto,
} from './dto/auth.dto';

interface SocialProfile {
  email: string | null;
  name: string | null;
  avatar: string | null;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');

  constructor(
    private readonly prisma: PrismaService,
    private readonly hash: HashService,
    private readonly sanctum: SanctumService,
    private readonly cache: CacheService,
    private readonly otp: OtpService,
    private readonly referral: ReferralService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  private get userType(): string {
    return this.config.get<AuthConfig>('auth')!.tokenableUserType;
  }

  private async loadWithProfile(userId: string) {
    return this.prisma.user.findUnique({ where: { id: userId }, include: { runnerProfile: true } });
  }

  // ── register ──────────────────────────────────────────────────────────────
  async register(dto: RegisterDto, userAgent: string): Promise<Record<string, unknown>> {
    const errors: Record<string, string[]> = {};
    if (!dto.phone && !dto.email) {
      errors.phone = ['The phone field is required when email is not present.'];
      errors.email = ['The email field is required when phone is not present.'];
    }
    // unique checks query the table directly (soft-deleted rows still "taken").
    if (dto.phone && (await this.prisma.user.findFirst({ where: { phone: dto.phone } }))) {
      errors.phone = ['This phone number is already registered.'];
    }
    if (dto.email && (await this.prisma.user.findFirst({ where: { email: dto.email } }))) {
      errors.email = ['This email is already registered.'];
    }
    if (Object.keys(errors).length) throw new LaravelValidationException(errors);

    const role = dto.role ?? 'customer';
    const referralCode = await this.referral.generateCode();

    const created = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          phone: dto.phone ?? null,
          email: dto.email ?? null,
          passwordHash: this.hash.make(dto.password),
          fullName: dto.full_name,
          role,
          status: 'active',
          referralCode,
        },
      });
      if (dto.role === 'runner') {
        await tx.runnerProfile.create({ data: { userId: u.id, verificationStatus: 'pending' } });
      }
      await tx.notification.create({
        data: {
          userId: u.id,
          type: 'system',
          title: 'Welcome to ErrandGuy!',
          body: 'Your account has been created successfully. Start exploring!',
          isRead: false,
        },
      });
      return u;
    });

    const { plainTextToken } = await this.sanctum.createToken(this.userType, created.id, userAgent);
    const withProfile = await this.loadWithProfile(created.id);
    return { user: userResource(withProfile!, undefined), token: plainTextToken };
  }

  // ── login ─────────────────────────────────────────────────────────────────
  async login(dto: LoginDto, userAgent: string): Promise<Record<string, unknown>> {
    const lockKey = `login_attempts:${dto.phone ?? dto.email ?? ''}`;
    if (this.cache.get<number>(lockKey) !== undefined && (this.cache.get<number>(lockKey) as number) >= 5) {
      throw LaravelValidationException.field(
        'email',
        'Too many login attempts. Please try again in 15 minutes.',
      );
    }

    const where: Record<string, unknown> = { deletedAt: null };
    if (dto.phone) where.phone = dto.phone;
    if (dto.email) where.email = dto.email;
    const user = await this.prisma.user.findFirst({ where });

    if (!user || !this.hash.check(dto.password, user.passwordHash)) {
      const count = Number(this.cache.get<number>(lockKey) ?? 0) + 1;
      this.cache.put(lockKey, count, 900);
      throw LaravelValidationException.field('credentials', 'The provided credentials are incorrect.');
    }

    if (user.status !== 'active') {
      throw LaravelValidationException.field(
        'status',
        `Your account is ${user.status}. Please contact support.`,
      );
    }

    this.cache.forget(lockKey);

    const deviceName = dto.device_name ?? userAgent ?? 'mobile';
    await this.sanctum.deleteTokensByName(this.userType, user.id, deviceName);
    const { plainTextToken } = await this.sanctum.createToken(this.userType, user.id, deviceName);
    await this.prisma.user.update({ where: { id: user.id }, data: { lastActiveAt: new Date() } });

    const withProfile = await this.loadWithProfile(user.id);
    return { user: userResource(withProfile!, undefined), token: plainTextToken };
  }

  // ── logout ────────────────────────────────────────────────────────────────
  async logout(tokenId: bigint): Promise<{ message: string }> {
    await this.sanctum.deleteToken(tokenId);
    return { message: 'Logged out successfully.' };
  }

  // ── OTP ───────────────────────────────────────────────────────────────────
  async sendOtp(phone?: string, email?: string): Promise<{ message: string }> {
    const identifier = phone ?? email;
    if (!identifier) {
      throw new LaravelValidationException({
        phone: ['The phone field is required when email is not present.'],
      });
    }
    const otp = this.otp.generateOTP();
    this.otp.storeOTP(identifier, otp);
    try {
      if (phone) this.otp.sendViaSMS(phone, otp);
      else await this.otp.sendViaEmail(email!, otp);
    } catch (e) {
      this.otp.invalidateOTP(identifier);
      this.logger.error(`OTP delivery failed: ${(e as Error).message}`);
      throw new HttpException(
        { message: 'Could not send verification code. Please try again.' },
        HttpStatus.BAD_GATEWAY,
      );
    }
    return { message: 'Verification code sent successfully.' };
  }

  async verifyOtp(dto: VerifyOtpDto, userAgent: string): Promise<Record<string, unknown>> {
    const identifier = dto.phone ?? dto.email;
    if (!identifier) {
      throw new LaravelValidationException({
        phone: ['The phone field is required when email is not present.'],
      });
    }
    const attempts = this.otp.getAttemptCount(identifier);
    if (attempts >= 5) {
      this.otp.invalidateOTP(identifier);
      throw new HttpException(
        { message: 'Too many failed attempts. Please request a new code.' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (!this.otp.verifyOTP(identifier, dto.code)) {
      throw new HttpException(
        { message: 'Invalid verification code.', attempts_remaining: Math.max(0, 4 - attempts) },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const where: Record<string, unknown> = { deletedAt: null };
    if (dto.phone) where.phone = dto.phone;
    if (dto.email) where.email = dto.email;
    const user = await this.prisma.user.findFirst({ where });

    if (user) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: dto.phone ? { phoneVerified: true } : { emailVerified: true },
      });
      const { plainTextToken } = await this.sanctum.createToken(this.userType, user.id, userAgent);
      const withProfile = await this.loadWithProfile(user.id);
      return {
        message: 'Verification successful.',
        user: userResource(withProfile!, undefined),
        token: plainTextToken,
      };
    }
    return { message: 'Verification successful.', verified: true };
  }

  // ── social login ────────────────────────────────────────────────────────────
  async socialLogin(dto: SocialLoginDto, userAgent: string): Promise<Record<string, unknown>> {
    const social =
      dto.provider === 'google'
        ? await this.verifyGoogleToken(dto.token)
        : await this.verifyFacebookToken(dto.token);

    if (!social || !social.email) {
      throw LaravelValidationException.field('token', 'Unable to verify social login. Please try again.');
    }

    let user = await this.prisma.user.findFirst({ where: { email: social.email, deletedAt: null } });
    if (!user) {
      const referralCode = await this.referral.generateCode();
      user = await this.prisma.user.create({
        data: {
          email: social.email,
          fullName: social.name ?? '',
          avatarUrl: social.avatar ?? null,
          passwordHash: this.hash.make(randomBytes(24).toString('hex')),
          emailVerified: true,
          status: 'active',
          role: 'customer',
          referralCode,
        },
      });
    }

    if (user.status !== 'active') {
      throw LaravelValidationException.field(
        'status',
        `Your account is ${user.status}. Please contact support.`,
      );
    }

    const { plainTextToken } = await this.sanctum.createToken(this.userType, user.id, userAgent);
    await this.prisma.user.update({ where: { id: user.id }, data: { lastActiveAt: new Date() } });
    const withProfile = await this.loadWithProfile(user.id);
    return { user: userResource(withProfile!, undefined), token: plainTextToken };
  }

  private async verifyGoogleToken(token: string): Promise<SocialProfile | null> {
    try {
      const { data } = await axios.get('https://oauth2.googleapis.com/tokeninfo', {
        params: { id_token: token },
        timeout: 10_000,
      });
      return { email: data.email ?? null, name: data.name ?? null, avatar: data.picture ?? null };
    } catch {
      return null;
    }
  }

  private async verifyFacebookToken(token: string): Promise<SocialProfile | null> {
    try {
      const { data } = await axios.get('https://graph.facebook.com/me', {
        params: { fields: 'id,name,email,picture.type(large)', access_token: token },
        timeout: 10_000,
      });
      return {
        email: data.email ?? null,
        name: data.name ?? null,
        avatar: data.picture?.data?.url ?? null,
      };
    } catch {
      return null;
    }
  }

  // ── password reset ────────────────────────────────────────────────────────
  async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
    const exists = await this.prisma.user.findFirst({ where: { email: dto.email } });
    if (!exists) {
      throw LaravelValidationException.field('email', 'No account found with this email address.');
    }
    const token = randomBytes(48).toString('base64url').slice(0, 64);
    await this.prisma.passwordResetToken.upsert({
      where: { email: dto.email },
      update: { token: this.hash.make(token), createdAt: new Date() },
      create: { email: dto.email, token: this.hash.make(token), createdAt: new Date() },
    });
    try {
      await this.mail.raw(
        dto.email,
        'ErrandGuy - Password Reset',
        `Your ErrandGuy password reset code is: ${token}\n\nThis code expires in 1 hour.`,
      );
    } catch (e) {
      this.logger.error(`Failed to send password reset email: ${(e as Error).message}`);
      throw new HttpException(
        { message: 'Unable to send reset email at this time. Please try again later.' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return { message: 'Password reset link sent to your email.' };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    if (dto.password !== dto.password_confirmation) {
      throw LaravelValidationException.field('password', 'The password confirmation does not match.');
    }
    const record = await this.prisma.passwordResetToken.findUnique({ where: { email: dto.email } });
    if (!record || !this.hash.check(dto.token, record.token)) {
      throw new HttpException(
        { message: 'Invalid or expired reset token.' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const ageMinutes = record.createdAt
      ? (Date.now() - record.createdAt.getTime()) / 60_000
      : Infinity;
    if (ageMinutes > 60) {
      await this.prisma.passwordResetToken.delete({ where: { email: dto.email } }).catch(() => undefined);
      throw new HttpException(
        { message: 'Reset token has expired. Please request a new one.' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const user = await this.prisma.user.findFirst({ where: { email: dto.email, deletedAt: null } });
    if (!user) throw new NotFoundException({ message: 'No account found with this email address.' });

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: this.hash.make(dto.password) },
    });
    await this.sanctum.deleteAllTokens(this.userType, user.id);
    await this.prisma.passwordResetToken.delete({ where: { email: dto.email } }).catch(() => undefined);
    return { message: 'Password has been reset successfully.' };
  }
}
