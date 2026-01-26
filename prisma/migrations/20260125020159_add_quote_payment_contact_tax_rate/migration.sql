/*
  Warnings:

  - Added the required column `taxRate` to the `Quote` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "contactData" JSONB,
ADD COLUMN     "paymentData" JSONB,
ADD COLUMN     "taxRate" DECIMAL(12,2) NOT NULL;
