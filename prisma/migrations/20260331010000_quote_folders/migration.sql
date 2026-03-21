CREATE TABLE "QuoteFolder" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "color" TEXT,
  "icon" TEXT,
  "position" INTEGER,
  "isArchived" BOOLEAN NOT NULL DEFAULT false,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "QuoteFolder_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Quote" ADD COLUMN "folderId" TEXT;

CREATE UNIQUE INDEX "QuoteFolder_workspaceId_name_key" ON "QuoteFolder"("workspaceId", "name");
CREATE INDEX "QuoteFolder_workspaceId_idx" ON "QuoteFolder"("workspaceId");
CREATE INDEX "QuoteFolder_createdByUserId_idx" ON "QuoteFolder"("createdByUserId");
CREATE INDEX "Quote_folderId_idx" ON "Quote"("folderId");

ALTER TABLE "QuoteFolder"
ADD CONSTRAINT "QuoteFolder_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuoteFolder"
ADD CONSTRAINT "QuoteFolder_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Quote"
ADD CONSTRAINT "Quote_folderId_fkey"
FOREIGN KEY ("folderId") REFERENCES "QuoteFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
