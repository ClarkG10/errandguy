import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

/** ApplyReferralRequest: code required|string|max:12. */
export class ApplyReferralDto {
  @IsNotEmpty({ message: 'A referral code is required.' })
  @IsString()
  @MaxLength(12, { message: 'The code must not be greater than 12 characters.' })
  code!: string;
}
