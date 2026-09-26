-- Phase 1: new NotificationType values. ALTER TYPE ... ADD VALUE gets its own
-- migration: Prisma runs each migration as one implicit transaction, and a
-- value added in a transaction cannot be used until that transaction commits.
-- (PostgreSQL 12+ allows several ADD VALUE statements in one transaction.)

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'INTEGRATION_ERROR';
ALTER TYPE "NotificationType" ADD VALUE 'SECURITY_ALERT';
