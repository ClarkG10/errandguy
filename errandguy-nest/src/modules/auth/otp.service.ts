import { Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'crypto';
import { CacheService } from '../../cache/cache.service';
import { HashService } from '../../common/auth/hash.service';
import { MailService } from '../../integrations/mail.service';

/** Port of OTPService. All state lives in the cache; the OTP is bcrypt-hashed. */
@Injectable()
export class OtpService {
  private readonly logger = new Logger('OTP');

  constructor(
    private readonly cache: CacheService,
    private readonly hash: HashService,
    private readonly mail: MailService,
  ) {}

  generateOTP(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
  }

  storeOTP(identifier: string, otp: string): void {
    this.cache.put(`otp:${identifier}`, this.hash.make(otp), 300);
    this.cache.forget(`otp_attempts:${identifier}`);
  }

  verifyOTP(identifier: string, code: string): boolean {
    const hashed = this.cache.get<string>(`otp:${identifier}`);
    if (!hashed) return false;
    const attempts = this.getAttemptCount(identifier);
    if (attempts >= 5) {
      this.invalidateOTP(identifier);
      return false;
    }
    if (!this.hash.check(code, hashed)) {
      this.incrementAttempts(identifier);
      return false;
    }
    this.invalidateOTP(identifier);
    return true;
  }

  invalidateOTP(identifier: string): void {
    this.cache.forget(`otp:${identifier}`);
    this.cache.forget(`otp_attempts:${identifier}`);
  }

  getAttemptCount(identifier: string): number {
    return Number(this.cache.get<number>(`otp_attempts:${identifier}`) ?? 0);
  }

  incrementAttempts(identifier: string): void {
    this.cache.put(`otp_attempts:${identifier}`, this.getAttemptCount(identifier) + 1, 300);
  }

  sendViaSMS(phone: string, otp: string): void {
    // DEV STUB — no SMS gateway wired (matches Laravel). Never throws.
    this.logger.log(`OTP for ${phone}: ${otp}`);
  }

  async sendViaEmail(email: string, otp: string): Promise<void> {
    await this.mail.raw(
      email,
      'ErrandGuy - Verification Code',
      `Your ErrandGuy verification code is: ${otp}. It expires in 5 minutes.`,
    );
  }
}
