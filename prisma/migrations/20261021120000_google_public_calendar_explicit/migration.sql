-- Google Calendar: no implicit "primary" public calendar any more.
--
-- Until now a GOOGLE_CALENDAR OrgIntegration whose config had no
-- publicCalendarId mirrored PUBLIC events to, and imported from, the
-- connected account's primary calendar. NULL is also what Settings saves
-- for "Don't mirror public events", so that opt-out did nothing. From now
-- on NULL means off: no public mirror and nothing to import
-- (src/server/google-calendar/config.ts).
--
-- Connections that relied on the implicit primary keep it, written down:
-- one whose calendars were never saved in Settings (no
-- integration.config_changed audit row for the org's Google Calendar)
-- gets the primary calendar's own id from its stored calendar list, or
-- the literal "primary" when the list has no primary entry. Its mirrors,
-- recorded under the alias "primary", move to that id too, so the next
-- sync patches them in place instead of deleting and re-creating them.
--
-- A club that did save its calendars with no public one chose "Don't
-- mirror public events" (or a reconnect dropped a calendar that no longer
-- exists). It stays NULL: its public events stop being mirrored, and Sync
-- now removes the copies the fallback put on its primary calendar.

CREATE TEMPORARY TABLE google_public_pin AS
SELECT i.id,
       i."organizationId",
       COALESCE(
         (SELECT c ->> 'id'
            FROM jsonb_array_elements(
                   CASE WHEN jsonb_typeof(i.config -> 'calendars') = 'array'
                        THEN i.config -> 'calendars' ELSE '[]'::jsonb END) AS c
           WHERE c ->> 'primary' = 'true' AND COALESCE(c ->> 'id', '') <> ''
           LIMIT 1),
         'primary') AS calendar_id
  FROM "OrgIntegration" i
 WHERE i.provider = 'GOOGLE_CALENDAR'
   AND btrim(COALESCE(i.config ->> 'publicCalendarId', '')) = ''
   AND NOT EXISTS (
         SELECT 1 FROM "OrgAuditLog" a
          WHERE a."organizationId" = i."organizationId"
            AND a.action = 'integration.config_changed'
            AND a."diffJson" ->> 'provider' = 'GOOGLE_CALENDAR'
            AND a."diffJson" -> 'keys' @> '["publicCalendarId"]'::jsonb);

UPDATE "OrgIntegration" i
   SET config = i.config || jsonb_build_object('publicCalendarId', p.calendar_id)
  FROM google_public_pin p
 WHERE i.id = p.id;

-- Same calendar, its own id: the alias goes. updatedAt stays (not an edit).
UPDATE "Event" e
   SET "googleCalendarId" = p.calendar_id
  FROM google_public_pin p
 WHERE e."organizationId" = p."organizationId"
   AND e."googleCalendarId" = 'primary'
   AND p.calendar_id <> 'primary'
   AND NOT EXISTS (
         SELECT 1 FROM "Event" d
          WHERE d."organizationId" = e."organizationId"
            AND d."googleCalendarId" = p.calendar_id
            AND d."googleEventId" = e."googleEventId");

DROP TABLE google_public_pin;
