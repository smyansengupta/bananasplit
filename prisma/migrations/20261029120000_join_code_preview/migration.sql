-- The public invite-code page, /join/[code]: the link an officer texts, and
-- what that text message previews as ("You've been invited to join <club>
-- on Bananasplit", with the club's logo).
--
-- app.org_by_join_code answers only a signed-in caller with a VERIFIED
-- email, and returns the club's settings with it (allowed domain, member
-- count). Whatever fetches a link to build a preview is signed out, so the
-- page needs a narrower question: which org does this live code open? This
-- answers that and nothing else, the org's id, for a code that is turned on
-- in an org that is not being deleted. What the page then shows is the
-- org's public name and logo (the same picture an emailed invite link
-- already shows signed out). Joining is unchanged: it still goes through
-- app.org_by_join_code with a verified account, the allowed domain and the
-- member cap.
--
-- Service path only (app_service), like app.invitation_by_token_hash and
-- app.poll_org_id; the page caps lookups per client IP (src/app/join/[code]).

CREATE FUNCTION app.join_code_org_id(p_code text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT j."organizationId"
    FROM public."OrgJoinCode" j
    JOIN public."Organization" o ON o."id" = j."organizationId"
   WHERE j."code" = upper(btrim(p_code))
     AND j."enabled"
     AND o."deletedAt" IS NULL
$$;

REVOKE ALL ON FUNCTION app.join_code_org_id(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.join_code_org_id(text) TO app_service;
