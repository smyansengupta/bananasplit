-- CRM Inbox items (src/server/crm/inbox-notify.ts): someone new, a booking,
-- a deal won or lost, a quote opened or accepted. Additive only.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CRM_NEW';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CRM_BOOKED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CRM_DEAL';
