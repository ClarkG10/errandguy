import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const PH_PHONE = /^(\+63|0)9\d{9}$/;
const PASSWORD_COMPLEXITY = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/;
const PASSWORD_MSG =
  'The password must be at least 8 characters and include upper and lower case letters, a number, and a symbol.';

export class RegisterDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(PH_PHONE, {
    message: 'Please enter a valid Philippine phone number (e.g., 09XXXXXXXXX or +639XXXXXXXXX).',
  })
  phone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @IsString()
  @MinLength(8, { message: PASSWORD_MSG })
  @Matches(PASSWORD_COMPLEXITY, { message: PASSWORD_MSG })
  password!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  full_name!: string;

  @IsOptional()
  @IsIn(['customer', 'runner'])
  role?: string;
}

export class LoginDto {
  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsString()
  @IsNotEmpty()
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  device_name?: string;
}

export class SendOtpDto {
  @IsOptional()
  @IsString()
  @Matches(PH_PHONE, { message: 'Please enter a valid Philippine phone number.' })
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}

export class VerifyOtpDto {
  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'The code must be 6 digits.' })
  code!: string;
}

export class SocialLoginDto {
  @IsIn(['google', 'facebook'])
  provider!: string;

  @IsString()
  @IsNotEmpty()
  token!: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @MinLength(8, { message: PASSWORD_MSG })
  @Matches(PASSWORD_COMPLEXITY, { message: PASSWORD_MSG })
  password!: string;

  @IsString()
  @IsNotEmpty()
  password_confirmation!: string;
}
