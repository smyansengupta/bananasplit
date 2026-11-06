-- A task nobody owns, posted for anyone to take.
--
--   NotificationType gains TASK_UP_FOR_GRABS: when a task is created
--   without an owner (or its owner is taken off), the members who can see
--   it get an Inbox notice that it's up for grabs. Email for it is off
--   until a member turns it on (DEFAULT_OFF_TYPES), so a busy organization
--   doesn't mail everyone each time.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'TASK_UP_FOR_GRABS';
