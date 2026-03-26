import { PartialType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaymentStatus, QuoteStatus } from '@prisma/client';
import { CreateQuoteDto } from './create-quote.dto';

export class UpdateQuoteDto extends PartialType(CreateQuoteDto) {
  @IsOptional()
  @IsEnum(QuoteStatus)
  status?: QuoteStatus;

  @IsOptional()
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;

  @IsOptional()
  @IsUUID()
  templateId?: string;
}
