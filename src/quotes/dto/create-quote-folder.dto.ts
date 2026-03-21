import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateQuoteFolderDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  description?: string;
}
