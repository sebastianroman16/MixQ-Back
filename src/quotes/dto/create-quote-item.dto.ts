import { IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreateQuoteItemDto {
  @IsString()
  title: string;

  @IsString()
  description: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsInt()
  @Min(0)
  unitPrice: number;

  @IsOptional()
  @IsUUID()
  serviceId?: string;
}
