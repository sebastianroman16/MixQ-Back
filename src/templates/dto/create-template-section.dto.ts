import {
  ArrayMinSize,
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TemplateSectionType } from '@prisma/client';
import { CreateTemplateItemDto } from './create-template-item.dto';

export class CreateTemplateSectionDto {
  @IsString()
  @MaxLength(120)
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
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreateTemplateItemDto)
  items: CreateTemplateItemDto[];
}
