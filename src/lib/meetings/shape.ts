import type { MeetingFormat } from "@/generated/prisma/enums";

/**
 * What the Meetings list calls each way a meeting happens
 * (docs/features/meetings.md). The enum is the stored fact; this is how it reads.
 */
export const FORMAT_LABEL: Record<MeetingFormat, string> = {
  ONLINE: "Online",
  IN_PERSON: "In person",
  HYBRID: "Hybrid",
};
