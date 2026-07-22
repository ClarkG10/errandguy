import { IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

/** WalletController::topUp validation (payment_method_id ownership checked in the controller). */
export class TopUpDto {
  @IsNumber() @Min(50) @Max(50000) amount!: number;
  @IsOptional() @IsString() payment_method_id?: string;
}
