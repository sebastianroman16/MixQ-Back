CREATE TABLE "SellerGoal" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "quotesCreatedTarget" INTEGER NOT NULL DEFAULT 0,
  "acceptedQuotesTarget" INTEGER NOT NULL DEFAULT 0,
  "paidRevenueTarget" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "acceptanceRateTarget" DECIMAL(5,4) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SellerGoal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SellerGoal_workspaceId_userId_periodStart_key" ON "SellerGoal"("workspaceId", "userId", "periodStart");
CREATE INDEX "SellerGoal_workspaceId_periodStart_idx" ON "SellerGoal"("workspaceId", "periodStart");
CREATE INDEX "SellerGoal_userId_idx" ON "SellerGoal"("userId");

ALTER TABLE "SellerGoal"
  ADD CONSTRAINT "SellerGoal_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SellerGoal"
  ADD CONSTRAINT "SellerGoal_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
