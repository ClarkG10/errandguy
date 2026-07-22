import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * Legacy POST /support/report (inline `$request->validate`). The plain
 * `exists:bookings,id` check (no ownership scope) is enforced in the controller.
 */
export class ReportDto {
  @IsOptional() @IsUUID() booking_id?: string;

  @IsString() @IsNotEmpty() @MaxLength(200) subject!: string;

  @IsString() @IsNotEmpty() @MaxLength(2000) description!: string;

  @IsString() @IsNotEmpty() @MaxLength(50) category!: string;
}
