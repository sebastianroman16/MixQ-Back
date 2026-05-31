CREATE TABLE "QuoteFavorite" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "QuoteFavorite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QuoteFavorite_userId_quoteId_key"
ON "QuoteFavorite"("userId", "quoteId");

CREATE INDEX "QuoteFavorite_userId_workspaceId_idx"
ON "QuoteFavorite"("userId", "workspaceId");

CREATE INDEX "QuoteFavorite_quoteId_idx"
ON "QuoteFavorite"("quoteId");

ALTER TABLE "QuoteFavorite"
ADD CONSTRAINT "QuoteFavorite_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuoteFavorite"
ADD CONSTRAINT "QuoteFavorite_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuoteFavorite"
ADD CONSTRAINT "QuoteFavorite_quoteId_fkey"
FOREIGN KEY ("quoteId") REFERENCES "Quote"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
