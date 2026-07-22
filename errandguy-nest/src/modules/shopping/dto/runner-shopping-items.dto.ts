import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsNotEmpty,
  IsString,
  ValidateNested,
} from 'class-validator';

/**
 * Runner-side checklist tick payload (inline `$request->validate(...)`):
 *   items => required|array|min:1|max:100
 *   items.*.id => required|string
 *   items.*.checked => required|boolean
 */
export class RunnerShoppingItemDto {
  @IsNotEmpty()
  @IsString()
  id!: string;

  @IsDefined()
  @IsBoolean()
  checked!: boolean;
}

export class RunnerUpdateShoppingItemsDto {
  @IsDefined()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => RunnerShoppingItemDto)
  items!: RunnerShoppingItemDto[];
}
