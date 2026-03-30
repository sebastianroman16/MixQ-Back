import { IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreateQuoteItemDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  unitPrice?: number;

  @IsOptional()
  @IsUUID()
  serviceId?: string;
}
