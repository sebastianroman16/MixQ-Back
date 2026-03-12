-- Plan extension
ALTER TYPE "PlanType" ADD VALUE IF NOT EXISTS 'BUSINESS';

-- Workspace role enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WorkspaceRole') THEN
    CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'ADMIN', 'EDITOR', 'VIEWER');
  END IF;
END
$$;

-- Workspace core tables
CREATE TABLE "Workspace" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkspaceMember" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "WorkspaceRole" NOT NULL DEFAULT 'VIEWER',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkspaceInvitation" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "role" "WorkspaceRole" NOT NULL,
  "token" TEXT NOT NULL,
  "invitedByUserId" TEXT,
  "acceptedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkspaceInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkspaceInvitation_token_key" ON "WorkspaceInvitation"("token");
CREATE INDEX "Workspace_ownerId_idx" ON "Workspace"("ownerId");
CREATE INDEX "WorkspaceMember_workspaceId_idx" ON "WorkspaceMember"("workspaceId");
CREATE INDEX "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");
CREATE INDEX "WorkspaceInvitation_workspaceId_idx" ON "WorkspaceInvitation"("workspaceId");
CREATE INDEX "WorkspaceInvitation_email_idx" ON "WorkspaceInvitation"("email");
CREATE INDEX "WorkspaceInvitation_workspaceId_email_idx" ON "WorkspaceInvitation"("workspaceId", "email");

-- New workspace scope columns
ALTER TABLE "User" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "SenderProfile" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "Service" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "Category" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "Template" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "Quote" ADD COLUMN "workspaceId" TEXT;

-- Backfill personal workspace for current users
INSERT INTO "Workspace" ("id", "name", "ownerId", "createdAt", "updatedAt")
SELECT
  u."id",
  COALESCE(NULLIF(TRIM(COALESCE(u."name", '')), ''), split_part(u."email", '@', 1), 'Workspace'),
  u."id",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User" u
ON CONFLICT ("id") DO NOTHING;

UPDATE "User" u
SET "workspaceId" = COALESCE(u."workspaceId", u."id")
WHERE u."workspaceId" IS NULL;

INSERT INTO "WorkspaceMember" ("id", "workspaceId", "userId", "role", "createdAt", "updatedAt")
SELECT
  (md5(random()::text || clock_timestamp()::text)::uuid::text),
  u."workspaceId",
  u."id",
  'OWNER'::"WorkspaceRole",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User" u
ON CONFLICT ("workspaceId", "userId") DO NOTHING;

UPDATE "SenderProfile" sp
SET "workspaceId" = COALESCE(sp."workspaceId", sp."userId")
WHERE sp."workspaceId" IS NULL;

UPDATE "Service" s
SET "workspaceId" = COALESCE(s."workspaceId", s."userId")
WHERE s."workspaceId" IS NULL;

UPDATE "Category" c
SET "workspaceId" = COALESCE(c."workspaceId", c."userId")
WHERE c."workspaceId" IS NULL;

UPDATE "Template" t
SET "workspaceId" = COALESCE(t."workspaceId", t."userId")
WHERE t."workspaceId" IS NULL
  AND t."type" = 'USER';

UPDATE "Quote" q
SET "workspaceId" = COALESCE(q."workspaceId", q."userId")
WHERE q."workspaceId" IS NULL;

-- Enforce non-null where required
ALTER TABLE "User" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "SenderProfile" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "Service" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "Category" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "Quote" ALTER COLUMN "workspaceId" SET NOT NULL;

-- Indexes and unique constraints for workspace scope
CREATE INDEX "User_workspaceId_idx" ON "User"("workspaceId");
CREATE INDEX "SenderProfile_workspaceId_idx" ON "SenderProfile"("workspaceId");
CREATE INDEX "Service_workspaceId_idx" ON "Service"("workspaceId");
CREATE INDEX "Category_workspaceId_idx" ON "Category"("workspaceId");
CREATE INDEX "Template_workspaceId_idx" ON "Template"("workspaceId");
CREATE INDEX "Quote_workspaceId_idx" ON "Quote"("workspaceId");

CREATE UNIQUE INDEX "Service_workspaceId_inventoryCode_key" ON "Service"("workspaceId", "inventoryCode");
CREATE UNIQUE INDEX "Quote_workspaceId_quoteNumber_key" ON "Quote"("workspaceId", "quoteNumber");

-- Foreign keys
ALTER TABLE "Workspace"
ADD CONSTRAINT "Workspace_ownerId_fkey"
FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "User"
ADD CONSTRAINT "User_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WorkspaceMember"
ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkspaceMember"
ADD CONSTRAINT "WorkspaceMember_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkspaceInvitation"
ADD CONSTRAINT "WorkspaceInvitation_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkspaceInvitation"
ADD CONSTRAINT "WorkspaceInvitation_invitedByUserId_fkey"
FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SenderProfile"
ADD CONSTRAINT "SenderProfile_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Service"
ADD CONSTRAINT "Service_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Category"
ADD CONSTRAINT "Category_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Template"
ADD CONSTRAINT "Template_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Quote"
ADD CONSTRAINT "Quote_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
