import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/** SupportMessageRequest: content required max2000; image_url nullable max2000. */
export class SupportMessageDto {
  @IsString() @IsNotEmpty() @MaxLength(2000) content!: string;

  @IsOptional() @IsString() @MaxLength(2000) image_url?: string;
}
