import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

/** SendMessageRequest (the `image` file is validated in the handler). */
export class SendMessageDto {
  @IsOptional() @IsString() @MaxLength(2000) content?: string;

  @IsOptional() @IsString() @IsUrl() @MaxLength(500) image_url?: string;
}
