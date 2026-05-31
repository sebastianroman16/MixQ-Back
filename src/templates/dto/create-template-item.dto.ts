import {
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { TemplateItemType } from '@prisma/client';

export class CreateTemplateItemDto {
  @IsString()
  @MaxLength(120)
  label: string;

  @IsOptional()
  @IsString()
  @MaxLength(1200)
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
