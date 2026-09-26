-- Phase 7: NotificationType values for optional notices to event attendees.
-- Own migration: an added enum value is unusable until its transaction commits.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'EVENT_UPDATED';
ALTER TYPE "NotificationType" ADD VALUE 'EVENT_CANCELLED';
