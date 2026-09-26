-- =====================================================================
-- B8 Themes: how the org logo shows (Settings > Theme > Logo display).
-- =====================================================================
-- One enum and one column on OrgTheme. No new table: the Phase 8 per-command
-- policies (members read; OWNER/ADMIN insert, update, delete) and GRANTs on
-- "OrgTheme" already cover the new column. Enum types need no grant (PUBLIC
-- has USAGE on types in public by default, like "ThemeMode").

-- CreateEnum
CREATE TYPE "ThemeLogoDisplay" AS ENUM ('LOGO_AND_NAME', 'LOGO_ONLY', 'NAME_ONLY');

-- AlterTable
ALTER TABLE "OrgTheme" ADD COLUMN "logoDisplay" "ThemeLogoDisplay" NOT NULL DEFAULT 'LOGO_AND_NAME';
