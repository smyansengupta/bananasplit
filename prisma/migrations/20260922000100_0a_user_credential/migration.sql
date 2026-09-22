-- Phase 0A: move the two secrets out of "User" into "UserCredential".
--
-- A column-level REVOKE has no effect while a role holds table-level SELECT,
-- and a column-level GRANT breaks every Prisma query that selects "User"
-- without an explicit select. Moving passwordHash and the ICS token into
-- their own table keeps "User" free of secrets, so 0B can grant table-level
-- SELECT on "User" and give UserCredential to the identity role (app_auth)
-- only. The Auth.js PrismaAdapter never reads passwordHash.

-- CreateTable
CREATE TABLE "UserCredential" (
    "userId" TEXT NOT NULL,
    "passwordHash" TEXT,
    "icsTokenHash" TEXT,
    "icsTokenCreatedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserCredential_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserCredential_icsTokenHash_key" ON "UserCredential"("icsTokenHash");

-- AddForeignKey
ALTER TABLE "UserCredential" ADD CONSTRAINT "UserCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-appended data move. Existing plaintext ICS tokens are hashed, so a
-- feed URL that is already subscribed keeps working after the migration.
-- sha256() is built in since PG11 (no pgcrypto). Timestamps are UTC wall
-- clock, like every TIMESTAMP(3) column in this schema.
INSERT INTO "UserCredential" ("userId", "passwordHash", "icsTokenHash", "icsTokenCreatedAt", "updatedAt")
SELECT u."id",
       u."passwordHash",
       CASE WHEN u."icsToken" IS NULL THEN NULL
            ELSE encode(sha256(convert_to(u."icsToken", 'UTF8')), 'hex') END,
       CASE WHEN u."icsToken" IS NULL THEN NULL ELSE (now() AT TIME ZONE 'UTC') END,
       (now() AT TIME ZONE 'UTC')
FROM "User" u
WHERE u."passwordHash" IS NOT NULL OR u."icsToken" IS NOT NULL;

-- DropIndex
DROP INDEX "User_icsToken_key";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "icsToken",
DROP COLUMN "passwordHash";
