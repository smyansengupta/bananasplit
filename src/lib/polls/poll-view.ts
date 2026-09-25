import type { PollAvailability } from "@/generated/prisma/enums";

/**
 * The poll as a respondent sees it (0A Fix 6). The public /poll/[pollId]
 * page is reachable by anyone with the link, so this DTO carries no user
 * ids, no emails, no member names and no guest keys: each respondent is an
 * opaque key ("r1", "r2", ...) with a display label. Guests show the name
 * they typed (a duplicate gets a " (2)" suffix); members show as "Member".
 *
 * Client-safe: no server imports.
 */

export interface PollViewSlot {
  id: string;
  startsAt: Date;
  endsAt: Date;
}

export interface PollViewResponse {
  slotId: string;
  /** Opaque, stable within one render; never a user id or key hash. */
  respondentKey: string;
  label: string;
  isGuest: boolean;
  availability: PollAvailability;
}

export interface PollView {
  id: string;
  title: string;
  description: string | null;
  timezone: string;
  durationMinutes: number;
  closesAt: Date | null;
  isFinalized: boolean;
  /** Only for members viewing in the app (links to the scheduled event). */
  finalizedEventId: string | null;
  slots: PollViewSlot[];
  responses: PollViewResponse[];
  /** The viewer's own answers, by slot id. */
  myResponses: Record<string, PollAvailability>;
  /** The name a returning guest answered under, to prefill the form. */
  myGuestName: string | null;
}

/** Who is looking: a member of the poll's org, or anyone else (a guest). */
export type PollViewer =
  | { kind: "member"; userId: string }
  | { kind: "guest"; guestKeyHash: string | null };

/** The stored poll, as loaded server-side (responses oldest first). */
export interface PollSource {
  id: string;
  title: string;
  description: string | null;
  timezone: string;
  durationMinutes: number;
  closesAt: Date | null;
  finalizedEventId: string | null;
  slots: PollViewSlot[];
  responses: {
    slotId: string;
    userId: string | null;
    guestName: string | null;
    guestKeyHash: string | null;
    availability: PollAvailability;
  }[];
}

/**
 * Identity of a stored respondent: a member by user id, a guest by their
 * key hash. Legacy guest rows (no key hash, before 0A) group by name.
 */
function sourceKey(r: PollSource["responses"][number]): string {
  if (r.userId) return `u:${r.userId}`;
  if (r.guestKeyHash) return `g:${r.guestKeyHash}`;
  return `n:${r.guestName ?? ""}`;
}

export function buildPollView(poll: PollSource, viewer: PollViewer): PollView {
  const opaque = new Map<string, { key: string; label: string; isGuest: boolean }>();
  const nameCounts = new Map<string, number>();

  for (const r of poll.responses) {
    const id = sourceKey(r);
    if (opaque.has(id)) continue;
    const isGuest = !r.userId;
    let label = "Member";
    if (isGuest) {
      const name = r.guestName?.trim() || "Guest";
      const seen = (nameCounts.get(name.toLowerCase()) ?? 0) + 1;
      nameCounts.set(name.toLowerCase(), seen);
      label = seen === 1 ? name : `${name} (${seen})`;
    }
    opaque.set(id, { key: `r${opaque.size + 1}`, label, isGuest });
  }

  const isMine = (r: PollSource["responses"][number]) =>
    viewer.kind === "member"
      ? r.userId === viewer.userId
      : viewer.guestKeyHash !== null && !r.userId && r.guestKeyHash === viewer.guestKeyHash;

  const myResponses: Record<string, PollAvailability> = {};
  let myGuestName: string | null = null;
  for (const r of poll.responses) {
    if (!isMine(r)) continue;
    myResponses[r.slotId] = r.availability;
    if (viewer.kind === "guest" && myGuestName === null) myGuestName = r.guestName;
  }

  return {
    id: poll.id,
    title: poll.title,
    description: poll.description,
    timezone: poll.timezone,
    durationMinutes: poll.durationMinutes,
    closesAt: poll.closesAt,
    isFinalized: poll.finalizedEventId !== null,
    finalizedEventId: viewer.kind === "member" ? poll.finalizedEventId : null,
    slots: poll.slots.map((s) => ({ id: s.id, startsAt: s.startsAt, endsAt: s.endsAt })),
    responses: poll.responses.map((r) => {
      const who = opaque.get(sourceKey(r))!;
      return {
        slotId: r.slotId,
        respondentKey: who.key,
        label: who.label,
        isGuest: who.isGuest,
        availability: r.availability,
      };
    }),
    myResponses,
    myGuestName,
  };
}
