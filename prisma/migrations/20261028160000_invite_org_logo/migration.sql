-- Email invites show the organization's picture next to its name
-- (onboarding's "What brings you here?" and the Personal home).
--
-- app.pending_invitations_for_me, restated from
-- 20260922000400_0b_rls_roles_policies_triggers with "orgLogo" (the
-- Organization.logo variants, the same public picture the join-code preview
-- shows). A new result column can't be added in place, so it is dropped and
-- made again, with the same EXECUTE grant.

DROP FUNCTION app.pending_invitations_for_me();

CREATE FUNCTION app.pending_invitations_for_me()
RETURNS TABLE ("id" text, "organizationId" text, "role" "Role", "expiresAt" timestamp(3),
               "orgName" text, "orgSlug" text, "orgLogo" jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT i."id", i."organizationId", i."role", i."expiresAt", o."name", o."slug", o."logo"
    FROM public."Invitation" i
    JOIN public."Organization" o ON o."id" = i."organizationId"
    JOIN public."User" u ON u."id" = app.user_id()
   WHERE u."emailVerified" IS NOT NULL
     AND i."email" = u."email" AND i."acceptedAt" IS NULL AND i."expiresAt" > app.utc_now()
$$;
REVOKE ALL ON FUNCTION app.pending_invitations_for_me() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.pending_invitations_for_me() TO app_user;
