import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const PH_PHONE = /^(\+63|0)9\d{9}$/;
const PH_PHONE_MSG = 'Phone must be a valid Philippine mobile number.';

export class UpdateProfileDto {
  @IsOptional() @IsString() @MaxLength(100) full_name?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @Matches(PH_PHONE, { message: PH_PHONE_MSG }) phone?: string;
  @IsOptional() @IsIn(['customer', 'runner']) role?: string;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) default_lat?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) default_lng?: number;
}

export class UpdateFcmTokenDto {
  @IsString() @IsNotEmpty() fcm_token!: string;
}

export class CreateAddressDto {
  @IsString() @IsNotEmpty() @MaxLength(50) label!: string;
  @IsString() @IsNotEmpty() address!: string;
  @IsNumber() @Min(-90) @Max(90) lat!: number;
  @IsNumber() @Min(-180) @Max(180) lng!: number;
  @IsOptional() @IsBoolean() is_default?: boolean;
}

export class UpdateAddressDto {
  @IsOptional() @IsString() @MaxLength(50) label?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) lat?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) lng?: number;
  @IsOptional() @IsBoolean() is_default?: boolean;
}

// Note: TrustedContactRequest keeps required rules on PUT too (asymmetry preserved).
export class TrustedContactDto {
  @IsString() @IsNotEmpty() @MaxLength(100) name!: string;
  @IsString() @IsNotEmpty() @Matches(PH_PHONE, { message: PH_PHONE_MSG }) phone!: string;
  @IsString() @IsNotEmpty() @MaxLength(30) relationship!: string;
  @IsOptional() @IsInt() @Min(1) priority?: number;
  @IsOptional() @IsBoolean() is_active?: boolean;
}
