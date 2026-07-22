import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * CreateTicketRequest. The `booking_id` ownership check (Rule::exists scoped to
 * the caller's bookings) is enforced in the controller, since it hits the DB.
 */
export class CreateTicketDto {
  @IsString() @IsNotEmpty() @MaxLength(200) subject!: string;

  @IsString() @IsNotEmpty() @MaxLength(50) category!: string;

  @IsString() @IsNotEmpty() @MaxLength(2000) message!: string;

  @IsOptional() @IsUUID() booking_id?: string;
}
