-- Dismissing someone new.
--
--   The x on a "joined" row (People, Since you were here) is kept with the
--   cards a member hid from Up next, as kind 'newcomer' with the member's
--   user id as refId. Own rows only, as before.

ALTER TABLE "UpNextDismissal" DROP CONSTRAINT "UpNextDismissal_kind_known";
ALTER TABLE "UpNextDismissal" ADD CONSTRAINT "UpNextDismissal_kind_known"
  CHECK ("kind" IN ('task', 'meeting', 'event', 'rsvp', 'poll', 'newcomer'));
