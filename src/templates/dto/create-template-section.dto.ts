import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TemplateSectionType } from '@prisma/client';
import { CreateTemplateItemDto } from './create-template-item.dto';

export class CreateTemplateSectionDto {
  @IsString()
  title: string;

  @IsEnum(TemplateSectionType)
  type: TemplateSectionType;

  @IsInt()
  @Min(0)
  position: number;

  @IsOptional()
  @IsObject()
  meta?: Record<string, unknown>;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateTemplateItemDto)
  items: CreateTemplateItemDto[];
}
