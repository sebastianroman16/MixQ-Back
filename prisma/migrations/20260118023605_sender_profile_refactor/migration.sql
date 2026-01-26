/*
  Warnings:

  - You are about to drop the column `companyProfile` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `isOnboarded` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `logoUrl` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "senderProfileSnapshot" JSONB;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "companyProfile",
DROP COLUMN "isOnboarded",
DROP COLUMN "logoUrl",
ADD COLUMN     "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SenderProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT,
    "addressLine" TEXT,
    "city" TEXT,
    "commune" TEXT,
    "logoUrl" TEXT,
    "legalName" TEXT,
    "rut" TEXT,
    "giro" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SenderProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SenderProfile_userId_key" ON "SenderProfile"("userId");

-- AddForeignKey
ALTER TABLE "SenderProfile" ADD CONSTRAINT "SenderProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
