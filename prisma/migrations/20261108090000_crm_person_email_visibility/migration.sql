-- A person's addresses follow the person: when members see only their own
-- records (crm_sees_all() false), a member reads, changes or removes an
-- address only of a person they can see. The EXISTS reads "CrmPerson" as the
-- member, under its own RLS. Inserts stay as they were: the unique
-- (organizationId, email) index still refuses an address someone else has.
DROP POLICY app_user_select ON "CrmPersonEmail";
CREATE POLICY app_user_select ON "CrmPersonEmail" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND ((SELECT app.crm_sees_all())
              OR EXISTS (SELECT 1 FROM "CrmPerson" p
                         WHERE p."id" = "CrmPersonEmail"."personId"
                           AND p."organizationId" = "CrmPersonEmail"."organizationId")));

DROP POLICY app_user_update ON "CrmPersonEmail";
CREATE POLICY app_user_update ON "CrmPersonEmail" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND ((SELECT app.crm_sees_all())
              OR EXISTS (SELECT 1 FROM "CrmPerson" p
                         WHERE p."id" = "CrmPersonEmail"."personId"
                           AND p."organizationId" = "CrmPersonEmail"."organizationId")))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()));

DROP POLICY app_user_delete ON "CrmPersonEmail";
CREATE POLICY app_user_delete ON "CrmPersonEmail" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND ((SELECT app.crm_sees_all())
              OR EXISTS (SELECT 1 FROM "CrmPerson" p
                         WHERE p."id" = "CrmPersonEmail"."personId"
                           AND p."organizationId" = "CrmPersonEmail"."organizationId")));
