-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('TASK_ASSIGNED', 'TASK_DUE_SOON', 'EVENT_INVITE', 'INVITE_ACCEPTED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "emailPreferences" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "linkUrl" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_organizationId_idx" ON "Notification"("organizationId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex (Task)
CREATE INDEX "Task_organizationId_deletedAt_parentTaskId_status_idx" ON "Task"("organizationId", "deletedAt", "parentTaskId", "status");

-- CreateIndex (Transaction)
CREATE INDEX "Transaction_organizationId_budgetPeriodId_voidedAt_idx" ON "Transaction"("organizationId", "budgetPeriodId", "voidedAt");

-- CreateIndex (Transaction)
CREATE INDEX "Transaction_organizationId_occurredAt_idx" ON "Transaction"("organizationId", "occurredAt");
