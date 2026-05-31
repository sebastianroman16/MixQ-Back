-- CreateEnum
CREATE TYPE "BillingProvider" AS ENUM ('FLOW');

-- CreateEnum
CREATE TYPE "BillingSubscriptionStatus" AS ENUM ('PENDING', 'ACTIVE', 'PAST_DUE', 'CANCELED');

-- CreateEnum
CREATE TYPE "BillingEventStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');

-- CreateTable
CREATE TABLE "BillingSubscription" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" "BillingProvider" NOT NULL DEFAULT 'FLOW',
    "providerCustomerId" TEXT,
    "providerSubscriptionId" TEXT,
    "providerPlanId" TEXT,
    "plan" "PlanType" NOT NULL DEFAULT 'FREE',
    "status" "BillingSubscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "currency" TEXT NOT NULL DEFAULT 'CLP',
    "monthlyAmount" INTEGER NOT NULL DEFAULT 0,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "gracePeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "canceledAt" TIMESTAMP(3),
    "lastInvoiceId" TEXT,
    "lastPaymentAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingCheckoutSession" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "BillingProvider" NOT NULL DEFAULT 'FLOW',
    "providerCustomerId" TEXT,
    "token" TEXT,
    "targetPlan" "PlanType" NOT NULL,
    "providerPlanId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CLP',
    "monthlyAmount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingCheckoutSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "provider" "BillingProvider" NOT NULL DEFAULT 'FLOW',
    "providerEventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" "BillingEventStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "error" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingSubscription_workspaceId_key" ON "BillingSubscription"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingSubscription_providerSubscriptionId_key" ON "BillingSubscription"("providerSubscriptionId");

-- CreateIndex
CREATE INDEX "BillingSubscription_provider_providerCustomerId_idx" ON "BillingSubscription"("provider", "providerCustomerId");

-- CreateIndex
CREATE INDEX "BillingSubscription_status_gracePeriodEnd_idx" ON "BillingSubscription"("status", "gracePeriodEnd");

-- CreateIndex
CREATE INDEX "BillingCheckoutSession_workspaceId_idx" ON "BillingCheckoutSession"("workspaceId");

-- CreateIndex
CREATE INDEX "BillingCheckoutSession_token_idx" ON "BillingCheckoutSession"("token");

-- CreateIndex
CREATE INDEX "BillingCheckoutSession_status_expiresAt_idx" ON "BillingCheckoutSession"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "BillingEvent_providerEventId_key" ON "BillingEvent"("providerEventId");

-- CreateIndex
CREATE INDEX "BillingEvent_workspaceId_idx" ON "BillingEvent"("workspaceId");

-- CreateIndex
CREATE INDEX "BillingEvent_status_createdAt_idx" ON "BillingEvent"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "BillingSubscription" ADD CONSTRAINT "BillingSubscription_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingEvent" ADD CONSTRAINT "BillingEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
