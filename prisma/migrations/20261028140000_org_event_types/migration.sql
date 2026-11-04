-- An organization's own event types (onboarding's Event types step).
--
--   OrgSettings.eventTypes: [{ "name": text, "color": "#rrggbb" }], named by
--   the organization (with suggestions), like its task tags. NULL until
--   it names any. OWNER/ADMIN write it, as the rest of OrgSettings (its RLS
--   policies, unchanged). app.org_settings_guard fires only on
--   ballotIndividualVisibility, so it needs no change.

ALTER TABLE "OrgSettings" ADD COLUMN "eventTypes" JSONB;
