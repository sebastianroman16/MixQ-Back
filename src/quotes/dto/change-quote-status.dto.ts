import { IsEnum } from 'class-validator';
import { QuoteStatus } from '@prisma/client';

export class ChangeQuoteStatusDto {
  @IsEnum(QuoteStatus)
  status: QuoteStatus;
}
