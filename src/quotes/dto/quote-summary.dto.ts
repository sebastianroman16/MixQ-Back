import { PaymentStatus, QuoteStatus } from '@prisma/client';

export class QuoteSummaryDto {
  id!: string;
  folderId!: string | null;
  templateId!: string | null;
  quoteNumber!: string;
  title!: string;
  clientData!: {
    name: string;
    rut: string;
    email: string;
  };
  total!: number;
  issuedAt!: string;
  validUntil!: string;
  sentAt!: string | null;
  viewedAt!: string | null;
  acceptedAt!: string | null;
  rejectedAt!: string | null;
  cancelledAt!: string | null;
  status!: QuoteStatus;
  paymentStatus!: PaymentStatus;
  itemsCount!: number;
  isFavorite!: boolean;
  seller!: { id: string; name: string | null } | null;
}
