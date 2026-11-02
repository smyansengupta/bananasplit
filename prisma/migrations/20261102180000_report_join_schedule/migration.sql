-- Saved reports, part two: a second database joined on a shared field, and
-- a schedule that emails a report and keeps a copy each time.
--
--   Report.joinWith and Report.schedule are the maker's (or an admin's, on a
--   shared report) to change, like the rest of a report.
--   NotificationType gains REPORT_SENT, so each member can turn the
--   scheduled report email off on their profile. No Notification row is
--   written for it; the value is the email preference's key.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'REPORT_SENT';

-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "joinWith" JSONB,
ADD COLUMN     "schedule" JSONB;


-- ---------------------------------------------------------------------------
-- Hand-written: grants.
-- ---------------------------------------------------------------------------
GRANT UPDATE ("joinWith", "schedule") ON "Report" TO app_user;
