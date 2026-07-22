import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * ShoppingItemsRequest (customer-side full replacement).
 *
 * Each element only needs a `name` (qty defaults to 1 in the service). Any
 * id/checked/checked_at the client sends is stripped by the whitelisting
 * ValidationPipe and re-derived server-side so the customer can never forge
 * a runner's tick state.
 */
export class ShoppingItemInputDto {
  // items.*.name => required|string|max:200
  @IsNotEmpty({ message: 'Every shopping item needs a name.' })
  @IsString()
  @MaxLength(200)
  name!: string;

  // items.*.qty => nullable|integer|min:1|max:999
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(999)
  qty?: number;
}

export class UpdateShoppingItemsDto {
  // items => present|array|max:100
  @IsDefined({ message: 'A shopping list (items) is required.' })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ShoppingItemInputDto)
  items!: ShoppingItemInputDto[];
}
