CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID');

ALTER TABLE "Quote"
ADD COLUMN "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING';
