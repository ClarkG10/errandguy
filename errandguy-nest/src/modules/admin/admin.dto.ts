import { ArrayMinSize, IsArray, IsEmail, IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { PaymentMethodCatalog } from '../payment/payment-method-catalog';

export class AdminLoginDto {
  @IsEmail() email!: string;
  @IsString() @IsNotEmpty() password!: string;
}

export class ReasonDto {
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}

export class ResolveDisputeDto {
  @IsString() @IsNotEmpty() @MaxLength(1000) resolution_note!: string;
}

export class SetPaymentMethodsDto {
  @IsArray() @ArrayMinSize(1)
  @IsIn(PaymentMethodCatalog.CATALOG.map((c) => c.type), { each: true })
  methods!: string[];
}
