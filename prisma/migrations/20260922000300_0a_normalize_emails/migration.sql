-- Phase 0A Fix 4(a): store emails as lower(btrim()) so invitation and
-- credentials lookups are case-insensitive. Refuses to run if normalization
-- would collide (two accounts differing only in case or whitespace); resolve
-- those by hand first. The existing @unique stays; no expression index,
-- because Prisma cannot mirror it.
DO $$
BEGIN
  IF EXISTS (
    SELECT lower(btrim("email")) FROM "User" GROUP BY 1 HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'normalize_emails: duplicate User emails after lower(btrim()); resolve by hand first';
  END IF;
END $$;
UPDATE "User" SET "email" = lower(btrim("email")) WHERE "email" <> lower(btrim("email"));
UPDATE "Invitation" SET "email" = lower(btrim("email")) WHERE "email" <> lower(btrim("email"));
