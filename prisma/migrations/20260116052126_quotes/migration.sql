/*
  Warnings:

  - You are about to drop the column `notes` on the `Quote` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[userId,quoteNumber]` on the table `Quote` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `clientData` to the `Quote` table without a default value. This is not possible if the table is not empty.
  - Added the required column `issuedAt` to the `Quote` table without a default value. This is not possible if the table is not empty.
  - Added the required column `netTotal` to the `Quote` table without a default value. This is not possible if the table is not empty.
  - Added the required column `quoteNumber` to the `Quote` table without a default value. This is not possible if the table is not empty.
  - Added the required column `validUntil` to the `Quote` table without a default value. This is not possible if the table is not empty.
  - Added the required column `title` to the `QuoteItem` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Quote" DROP COLUMN "notes",
ADD COLUMN     "clientData" JSONB NOT NULL,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "eventData" JSONB,
ADD COLUMN     "issuedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "netTotal" DECIMAL(12,2) NOT NULL,
ADD COLUMN     "quoteNumber" TEXT NOT NULL,
ADD COLUMN     "subtitle" TEXT,
ADD COLUMN     "validUntil" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "QuoteItem" ADD COLUMN     "title" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "QuoteSection" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "TemplateSectionType" NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "QuoteSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteSectionItem" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" TEXT,
    "type" "TemplateItemType" NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "QuoteSectionItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuoteSection_quoteId_idx" ON "QuoteSection"("quoteId");

-- CreateIndex
CREATE INDEX "QuoteSectionItem_sectionId_idx" ON "QuoteSectionItem"("sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_userId_quoteNumber_key" ON "Quote"("userId", "quoteNumber");

-- AddForeignKey
ALTER TABLE "QuoteSection" ADD CONSTRAINT "QuoteSection_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteSectionItem" ADD CONSTRAINT "QuoteSectionItem_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "QuoteSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
