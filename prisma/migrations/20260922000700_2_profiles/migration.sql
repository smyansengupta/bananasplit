-- =====================================================================
-- Phase 2: Profiles
-- =====================================================================
-- Profile columns on "User", a per-org title on Membership, and User.timezone
-- becoming "NULL = follow the org". No credential SQL here: UserCredential
-- and the ICS functions shipped in 0A/0B.

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "title" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatar" JSONB,
ADD COLUMN     "bio" TEXT,
ADD COLUMN     "gradYear" INTEGER,
ADD COLUMN     "links" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "major" TEXT,
ADD COLUMN     "pronouns" TEXT,
ALTER COLUMN "timezone" DROP NOT NULL,
ALTER COLUMN "timezone" DROP DEFAULT;

-- Hand-added backfill: no app code has ever written User.timezone (only the
-- seed set it), so 'UTC' is the old column default, not a user's choice.
UPDATE "User" SET "timezone" = NULL WHERE "timezone" = 'UTC';

-- app_user may update only its own row (0B policy) and only these columns:
-- the 0B profile columns plus the Phase 2 ones. email and emailVerified stay
-- non-writable, which protects the invite flow (T18e).
GRANT UPDATE ("pronouns", "major", "gradYear", "bio", "links", "avatar") ON "User" TO app_user;
