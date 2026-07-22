import { Type } from 'class-transformer';
import {
  IsArray,
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
  ValidateNested,
} from 'class-validator';

const PH_PHONE = /^(\+63|0)9\d{9}$/;

export class ShoppingItemInput {
  @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
  @IsOptional() @IsInt() @Min(1) @Max(999) qty?: number;
}

/** CreateBookingRequest — unconditional rules here; conditional rules enforced in BookingService.validateCreate. */
export class CreateBookingDto {
  @IsString() @IsNotEmpty() errand_type_id!: string;
  @IsString() @IsNotEmpty() pickup_address!: string;
  @IsNumber() @Min(-90) @Max(90) pickup_lat!: number;
  @IsNumber() @Min(-180) @Max(180) pickup_lng!: number;
  @IsOptional() @IsString() @MaxLength(100) pickup_contact_name?: string;
  @IsOptional() @IsString() @Matches(PH_PHONE, { message: 'Pickup phone must be a valid Philippine mobile number.' }) pickup_contact_phone?: string;
  @IsOptional() @IsString() dropoff_address?: string;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) dropoff_lat?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) dropoff_lng?: number;
  @IsOptional() @IsString() @MaxLength(100) dropoff_contact_name?: string;
  @IsOptional() @IsString() @Matches(PH_PHONE, { message: 'Dropoff phone must be a valid Philippine mobile number.' }) dropoff_contact_phone?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsString() @MaxLength(300) special_instructions?: string;
  @IsOptional() @IsNumber() @Min(0) estimated_item_value?: number;
  @IsOptional() @IsNumber() @Min(1) @Max(50000) shopping_budget?: number;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ShoppingItemInput) shopping_items?: ShoppingItemInput[];
  @IsIn(['now', 'scheduled']) schedule_type!: string;
  @IsOptional() @IsString() scheduled_at?: string;
  @IsIn(['fixed', 'negotiate']) pricing_mode!: string;
  @IsOptional() @IsIn(['walk', 'bicycle', 'motorcycle', 'car']) vehicle_type_rate?: string;
  @IsOptional() @IsNumber() @Min(0) customer_offer?: number;
  @IsString() @IsNotEmpty() payment_method!: string;
  @IsOptional() @IsString() payment_method_id?: string;
  @IsOptional() @IsString() promo_code?: string;
}

export class EstimateDto {
  @IsString() @IsNotEmpty() errand_type_id!: string;
  @IsNumber() @Min(-90) @Max(90) pickup_lat!: number;
  @IsNumber() @Min(-180) @Max(180) pickup_lng!: number;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) dropoff_lat?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) dropoff_lng?: number;
  @IsOptional() @IsIn(['walk', 'bicycle', 'motorcycle', 'car']) vehicle_type_rate?: string;
}

export class CancelBookingDto {
  @IsString() @IsNotEmpty() @MaxLength(300) reason!: string;
}

export class RetryMatchDto {
  @IsOptional() @IsInt() @Min(1) @Max(3) widen_step?: number;
}
