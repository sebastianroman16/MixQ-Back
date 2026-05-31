-- CreateTable
CREATE TABLE "FrequentClient" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "label" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rut" TEXT,
    "giro" TEXT,
    "email" TEXT NOT NULL,
    "address" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FrequentClient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FrequentClient_workspaceId_label_key" ON "FrequentClient"("workspaceId", "label");

-- CreateIndex
CREATE INDEX "FrequentClient_workspaceId_idx" ON "FrequentClient"("workspaceId");

-- CreateIndex
CREATE INDEX "FrequentClient_createdByUserId_idx" ON "FrequentClient"("createdByUserId");

-- AddForeignKey
ALTER TABLE "FrequentClient" ADD CONSTRAINT "FrequentClient_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FrequentClient" ADD CONSTRAINT "FrequentClient_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
