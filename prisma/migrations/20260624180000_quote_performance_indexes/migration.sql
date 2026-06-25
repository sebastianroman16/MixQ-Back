-- Composite indexes for the quote list filters and dashboard aggregations.
CREATE INDEX "Quote_workspaceId_createdAt_idx" ON "Quote"("workspaceId", "createdAt");
CREATE INDEX "Quote_workspaceId_issuedAt_idx" ON "Quote"("workspaceId", "issuedAt");
CREATE INDEX "Quote_workspaceId_status_idx" ON "Quote"("workspaceId", "status");
CREATE INDEX "Quote_workspaceId_folderId_idx" ON "Quote"("workspaceId", "folderId");
CREATE INDEX "Quote_workspaceId_userId_idx" ON "Quote"("workspaceId", "userId");
CREATE INDEX "Quote_workspaceId_paymentStatus_idx" ON "Quote"("workspaceId", "paymentStatus");
