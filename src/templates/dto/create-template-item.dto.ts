import { IsEnum, IsInt, IsObject, IsOptional, IsString, Min } from 'class-validator';
import { TemplateItemType } from '@prisma/client';

export class CreateTemplateItemDto {
  @IsString()
  label: string;

  @IsOptional()
  @IsString()
  value?: string;

  @IsEnum(TemplateItemType)
  type: TemplateItemType;

  @IsInt()
  @Min(0)
  position: number;

  @IsOptional()
  @IsObject()
  meta?: Record<string, unknown>;
}
