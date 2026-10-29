-- Meeting types on meetings: the organization's own types (OrgSettings.eventTypes,
-- named and coloured on onboarding's meetings step) are picked on a meeting,
-- which the calendar then draws in that type's colour. Stored by name, like
-- the type list itself; a name no longer in the list just draws in the
-- meeting's kind colour. The table's existing grants and policies cover it.
ALTER TABLE "Event" ADD COLUMN "meetingType" TEXT;
ALTER TABLE "Event" ADD CONSTRAINT "Event_meetingType_length"
  CHECK ("meetingType" IS NULL OR char_length("meetingType") BETWEEN 1 AND 40);
