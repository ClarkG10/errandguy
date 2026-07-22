import { IsDateString, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class LinkMethodDto {
  @IsIn(['gcash', 'maya', 'grabpay']) channel!: string;
}

export class StoreMethodDto {
  @IsIn(['card', 'gcash', 'maya']) type!: string;
  @IsString() @MaxLength(500) gateway_token!: string;
  @IsOptional() @IsString() @MaxLength(100) label?: string;
  @IsOptional() @IsString() @MaxLength(4) last_four?: string;
  @IsOptional() @IsString() @MaxLength(20) card_brand?: string;
  @IsOptional() @IsDateString() expires_at?: string;
}
