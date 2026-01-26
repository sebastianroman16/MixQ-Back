/*
  Warnings:

  - You are about to drop the column `description` on the `Template` table. All the data in the column will be lost.
  - You are about to drop the column `description` on the `TemplateItem` table. All the data in the column will be lost.
  - You are about to drop the column `quantity` on the `TemplateItem` table. All the data in the column will be lost.
  - You are about to drop the column `serviceId` on the `TemplateItem` table. All the data in the column will be lost.
  - You are about to drop the column `templateId` on the `TemplateItem` table. All the data in the column will be lost.
  - You are about to drop the column `total` on the `TemplateItem` table. All the data in the column will be lost.
  - You are about to drop the column `unitPrice` on the `TemplateItem` table. All the data in the column will be lost.
  - Added the required column `label` to the `TemplateItem` table without a default value. This is not possible if the table is not empty.
  - Added the required column `sectionId` to the `TemplateItem` table without a default value. This is not possible if the table is not empty.
  - Added the required column `type` to the `TemplateItem` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "TemplateType" AS ENUM ('SYSTEM', 'USER');

-- CreateEnum
CREATE TYPE "TemplateSectionType" AS ENUM ('HEADER', 'SUBTITLE', 'CLIENT', 'EVENT', 'TABLE', 'TOTALS', 'TERMS', 'PAYMENT', 'CONTACT');

-- CreateEnum
CREATE TYPE "TemplateItemType" AS ENUM ('TEXT', 'FIELD', 'TABLE_COLUMN');

-- DropForeignKey
ALTER TABLE "TemplateItem" DROP CONSTRAINT "TemplateItem_serviceId_fkey";

-- DropForeignKey
ALTER TABLE "TemplateItem" DROP CONSTRAINT "TemplateItem_templateId_fkey";

-- DropIndex
DROP INDEX "TemplateItem_serviceId_idx";

-- DropIndex
DROP INDEX "TemplateItem_templateId_idx";

-- AlterTable
ALTER TABLE "Template" DROP COLUMN "description",
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "type" "TemplateType" NOT NULL DEFAULT 'USER',
ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "TemplateItem" DROP COLUMN "description",
DROP COLUMN "quantity",
DROP COLUMN "serviceId",
DROP COLUMN "templateId",
DROP COLUMN "total",
DROP COLUMN "unitPrice",
ADD COLUMN     "label" TEXT NOT NULL,
ADD COLUMN     "sectionId" TEXT NOT NULL,
ADD COLUMN     "type" "TemplateItemType" NOT NULL,
ADD COLUMN     "value" TEXT;

-- CreateTable
CREATE TABLE "TemplateSection" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "TemplateSectionType" NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "TemplateSection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TemplateSection_templateId_idx" ON "TemplateSection"("templateId");

-- CreateIndex
CREATE INDEX "Template_type_idx" ON "Template"("type");

-- CreateIndex
CREATE INDEX "TemplateItem_sectionId_idx" ON "TemplateItem"("sectionId");

-- AddForeignKey
ALTER TABLE "TemplateSection" ADD CONSTRAINT "TemplateSection_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateItem" ADD CONSTRAINT "TemplateItem_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "TemplateSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
