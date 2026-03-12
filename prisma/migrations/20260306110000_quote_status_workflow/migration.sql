-- Add VIEWED status to quote status enum
ALTER TYPE "QuoteStatus" ADD VALUE IF NOT EXISTS 'VIEWED';

-- Add workflow timestamps to Quote
ALTER TABLE "Quote"
ADD COLUMN "sentAt" TIMESTAMP(3),
ADD COLUMN "viewedAt" TIMESTAMP(3),
ADD COLUMN "acceptedAt" TIMESTAMP(3),
ADD COLUMN "rejectedAt" TIMESTAMP(3),
ADD COLUMN "cancelledAt" TIMESTAMP(3);

-- Create status history table
CREATE TABLE "QuoteStatusHistory" (
  "id" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "fromStatus" "QuoteStatus",
  "toStatus" "QuoteStatus" NOT NULL,
  "changedBy" TEXT,
  "source" TEXT NOT NULL DEFAULT 'INTERNAL',
  "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QuoteStatusHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "QuoteStatusHistory_quoteId_changedAt_idx"
ON "QuoteStatusHistory"("quoteId", "changedAt");

ALTER TABLE "QuoteStatusHistory"
ADD CONSTRAINT "QuoteStatusHistory_quoteId_fkey"
FOREIGN KEY ("quoteId") REFERENCES "Quote"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
