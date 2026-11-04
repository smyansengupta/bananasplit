-- CRM Phase 2, "Reaching out" (docs/features/crm.md, "Phase 2 as built").
--
-- Every outreach table already exists (20261105090000_crm). This adds only
-- what the public side needs to find its organization without one:
--
--   app.crm_public_target(kind, key)
--       Which organization (and row) a public link opens, ids only, the way
--       app.form_page and app.report_link_target do for theirs:
--         booking  /book/{slug}            a live booking page by its slug
--         guest    /g/{token}              a live guest link by its token's hash
--         self     /c/{token}              a person in the CRM by their
--                                          self-update token's hash
--         bcc      log+{token}@inbound     a member's BCC logging address
--         track    /api/crm/t/{token}      an email by its tracking token
--                                          (also its Reply-To address)
--       Service role only. Each caller then opens withSystemOrgTx in that
--       one organization and acts there.
--
--   app.crm_booking_busy(page)
--       The busy hours (cells only: no rules, no labels) of a booking
--       page's hosts who are still members, in the caller's organization
--       context only. A member who puts themselves on a booking page has
--       chosen to be booked through it; nothing else of their availability
--       is reachable. Service role only.
--
-- And the Inbox: the follow-up queue's rows are "crm:{id}", so a member can
-- snooze one in the Inbox or on the CRM's home alike (InboxItemState).

CREATE OR REPLACE FUNCTION app.crm_public_target(p_kind text, p_key text)
RETURNS TABLE ("organizationId" text, "id" text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT b."organizationId", b."id" FROM public."CrmBookingPage" b
   WHERE p_kind = 'booking' AND b."slug" = p_key AND b."active"
  UNION ALL
  SELECT g."organizationId", g."id" FROM public."CrmGuestLink" g
   WHERE p_kind = 'guest' AND g."tokenHash" = p_key AND g."revokedAt" IS NULL
     AND (g."expiresAt" IS NULL OR g."expiresAt" > now())
  UNION ALL
  SELECT p."organizationId", p."id" FROM public."CrmPerson" p
   WHERE p_kind = 'self' AND p."selfUpdateTokenHash" = p_key AND p."deletedAt" IS NULL
  UNION ALL
  SELECT m."organizationId", m."id" FROM public."CrmMemberSettings" m
   WHERE p_kind = 'bcc' AND m."bccToken" = p_key
  UNION ALL
  SELECT e."organizationId", e."id" FROM public."CrmEmailMessage" e
   WHERE p_kind = 'track' AND e."trackingToken" = p_key
$$;
REVOKE ALL ON FUNCTION app.crm_public_target(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.crm_public_target(text, text) TO app_service;

CREATE OR REPLACE FUNCTION app.crm_booking_busy(p_page text)
RETURNS TABLE ("userId" text, "busy" text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT m."userId", COALESCE(a."busy", ARRAY[]::text[])
    FROM public."CrmBookingPage" b
    JOIN public."Membership" m
      ON m."organizationId" = b."organizationId" AND m."userId" = ANY (b."hostIds")
    LEFT JOIN public."UserAvailability" a ON a."userId" = m."userId"
   WHERE app.org_id() IS NOT NULL
     AND b."organizationId" = app.org_id()
     AND b."id" = p_page
$$;
REVOKE ALL ON FUNCTION app.crm_booking_busy(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.crm_booking_busy(text) TO app_service;

ALTER TABLE "InboxItemState" DROP CONSTRAINT "InboxItemState_itemKey_known";
ALTER TABLE "InboxItemState" ADD CONSTRAINT "InboxItemState_itemKey_known"
  CHECK ("itemKey" ~ '^(invite|task|request|review|update|crm):[A-Za-z0-9_-]{1,64}$');
