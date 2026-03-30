import { IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreateServiceDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @IsInt()
  @Min(0)
  unitPrice: number;

  @IsInt()
  @Min(0)
  quantity: number;
}
