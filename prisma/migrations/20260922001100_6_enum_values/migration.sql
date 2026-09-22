-- Phase 6: new enum values, in their own migration. A value added by
-- ALTER TYPE ... ADD VALUE cannot be used until its transaction commits, and
-- Prisma runs each migration as one transaction, so nothing here uses them.

-- AlterEnum (hand-edited: BEFORE 'COMPLETED' keeps the kanban column order;
-- Prisma generates a plain ADD VALUE and does not diff enum order)
ALTER TYPE "TaskStatus" ADD VALUE 'BLOCKED' BEFORE 'COMPLETED';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'TASK_MENTIONED';
ALTER TYPE "NotificationType" ADD VALUE 'TASK_COMMENTED';
ALTER TYPE "NotificationType" ADD VALUE 'TASK_DUE_REMINDER';
ALTER TYPE "NotificationType" ADD VALUE 'TASK_DIGEST';
ALTER TYPE "NotificationType" ADD VALUE 'TASK_FLAGGED';
ALTER TYPE "NotificationType" ADD VALUE 'WEEKLY_UPDATE_REMINDER';
