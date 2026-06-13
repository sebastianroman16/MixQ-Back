import { IsUUID } from 'class-validator';

export class AssignQuoteSellerDto {
  @IsUUID()
  sellerId!: string;
}
