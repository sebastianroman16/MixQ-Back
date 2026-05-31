import {
  IsArray,
  ArrayMaxSize,
  IsDateString,
  IsEnum,
  IsInt,
  IsObject,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentStatus } from '@prisma/client';
import { CreateQuoteItemDto } from './create-quote-item.dto';
import { IsLogoUrl } from '../../common/validators/logo-url.validator';

export class CreateQuoteDto {
  @IsOptional()
  @IsUUID()
  templateId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  quoteNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  subtitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(3000)
  description?: string;

  @IsOptional()
  @IsObject()
  clientData?: Record<string, string>;

  @IsOptional()
  @IsObject()
  eventData?: Record<string, string>;

  @IsOptional()
  @IsObject()
  paymentData?: Record<string, string>;

  @IsOptional()
  @IsObject()
  contactData?: Record<string, string>;

  @IsOptional()
  @IsString()
  @IsLogoUrl({ maxBytes: 2 * 1024 * 1024 })
  logoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  termsText?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateQuoteItemDto)
  items?: CreateQuoteItemDto[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  taxRate?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  discount?: number;

  @IsOptional()
  @IsDateString()
  issuedAt?: string;

  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @IsOptional()
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;
}
