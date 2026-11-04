-- Home's layout mode, per member: AMBIENT (the default, Home arranges and
-- sizes itself) or CUSTOM (the member's own arrangement). Null reads as
-- AMBIENT. MemberPrefs is owner-only under RLS already.
ALTER TABLE "MemberPrefs" ADD COLUMN "homeMode" TEXT;
ALTER TABLE "MemberPrefs" ADD CONSTRAINT "MemberPrefs_homeMode_check"
  CHECK ("homeMode" IS NULL OR "homeMode" IN ('AMBIENT', 'CUSTOM'));
