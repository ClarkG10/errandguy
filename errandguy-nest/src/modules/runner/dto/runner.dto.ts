import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** UpdateRunnerProfileRequest — every field `sometimes`; nullable ones may be null. */
export class UpdateRunnerProfileDto {
  @IsOptional() @IsIn(['walk', 'bicycle', 'motorcycle', 'car']) vehicle_type?: string;
  @IsOptional() @IsString() @MaxLength(20) vehicle_plate?: string | null;
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'The preferred types field must have at least 1 items.' })
  @IsString({ each: true })
  preferred_types?: string[];
  @IsOptional() @IsNumber() @Min(-90) @Max(90) working_area_lat?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) working_area_lng?: number;
  @IsOptional() @IsInt() @Min(1000) @Max(50000) working_area_radius?: number;
  @IsOptional() @IsString() @MaxLength(100) bank_name?: string | null;
  @IsOptional() @IsString() @MaxLength(50) bank_account_number?: string | null;
  @IsOptional() @IsString() @MaxLength(20) ewallet_number?: string | null;
}

/** ToggleOnlineRequest — lat/lng `required_if:is_online,true` enforced in the controller. */
export class ToggleOnlineDto {
  @IsBoolean() is_online!: boolean;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) lat?: number | null;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) lng?: number | null;
}

/** UpdateLocationRequest — negative heading/speed sanitized to null in the controller. */
export class UpdateLocationDto {
  @IsNumber() @Min(-90) @Max(90) lat!: number;
  @IsNumber() @Min(-180) @Max(180) lng!: number;
  @IsOptional() @IsNumber() heading?: number | null;
  @IsOptional() @IsNumber() speed?: number | null;
  @IsOptional() @IsNumber() @Min(0) accuracy?: number | null;
  @IsOptional() @IsUUID() booking_id?: string | null;
}

/** PayoutRequest. */
export class PayoutDto {
  @IsNumber() @Min(1) amount!: number;
}
