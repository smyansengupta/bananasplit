-- A meeting's recording link (Past's "Recording" in the workspace plan).
-- Hosts paste it on the meeting page; nothing fills it automatically.
ALTER TABLE "Event" ADD COLUMN "recordingUrl" TEXT;
