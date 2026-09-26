-- Phase 0A Fix 6: per-guest edit key for public poll responses.
-- The server sets an httpOnly cookie poll_guest_<pollId> holding 32 random
-- bytes, stores sha256 of it here, and scopes the delete-then-recreate to
-- that hash, so typing another guest's name can no longer wipe their answers.
-- Legacy guest rows keep guestKeyHash NULL: still visible, no longer editable
-- by a visitor.

-- AlterTable
ALTER TABLE "PollResponse" ADD COLUMN     "guestKeyHash" TEXT;

-- CreateIndex
CREATE INDEX "PollResponse_pollId_guestKeyHash_idx" ON "PollResponse"("pollId", "guestKeyHash");

-- CreateIndex
CREATE UNIQUE INDEX "PollResponse_slotId_guestKeyHash_key" ON "PollResponse"("slotId", "guestKeyHash");
