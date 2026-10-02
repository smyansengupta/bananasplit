-- A sponsorship is cash (money paid to the club) or credits (a sponsor's
-- platform credits: cloud, API, software). Credits keep a dollar value for
-- the pipeline but never reach the ledger: marking them received records no
-- transaction, and they stay out of the balance, the runway and the cash
-- totals. Every existing sponsorship is cash. Policies and grants on
-- "Sponsorship" are table-wide, so the new column needs none of its own.

-- CreateEnum
CREATE TYPE "SponsorshipType" AS ENUM ('CASH', 'CREDITS');

-- AlterTable
ALTER TABLE "Sponsorship" ADD COLUMN "type" "SponsorshipType" NOT NULL DEFAULT 'CASH';
