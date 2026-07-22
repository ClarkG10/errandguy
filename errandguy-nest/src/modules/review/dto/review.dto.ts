import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** ReviewRequest: rating required int 1..5; comment nullable string max 500. */
export class ReviewDto {
  @IsInt() @Min(1) @Max(5) rating!: number;
  @IsOptional() @IsString() @MaxLength(500) comment?: string;
}
