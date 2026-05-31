import { PlanType } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class CreateSubscriptionCheckoutDto {
  @IsEnum(PlanType)
  plan: PlanType;
}
