import { Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class UpdateSellerGoalDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}$/)
  month?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  quotesCreatedTarget?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  acceptedQuotesTarget?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  paidRevenueTarget?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  acceptanceRateTarget?: number;
}
