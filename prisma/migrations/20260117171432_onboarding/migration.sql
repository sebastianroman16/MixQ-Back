-- AlterTable
ALTER TABLE "User" ADD COLUMN     "companyProfile" JSONB,
ADD COLUMN     "isOnboarded" BOOLEAN NOT NULL DEFAULT false;
