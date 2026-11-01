import type { TxClient } from "@/server/db/context";

export interface InboxState {
  /** Items put off until later, by key, with when each comes back. */
  snoozed: Map<string, Date>;
  /** Items finished with (an update marked Done). */
  done: Set<string>;
}

/**
 * What this member snoozed (still in the future) and finished in this
 * space. Own rows only (RLS); a snooze that has run out is simply ignored,
 * so the item is back without a job to wake it.
 */
export async function loadInboxState(
  db: TxClient,
  orgId: string,
  userId: string,
  now: Date,
): Promise<InboxState> {
  const rows = await db.inboxItemState.findMany({
    where: {
      organizationId: orgId,
      userId,
      OR: [{ snoozedUntil: { gt: now } }, { doneAt: { not: null } }],
    },
    select: { itemKey: true, snoozedUntil: true, doneAt: true },
  });
  const snoozed = new Map<string, Date>();
  const done = new Set<string>();
  for (const r of rows) {
    if (r.doneAt) done.add(r.itemKey);
    else if (r.snoozedUntil && r.snoozedUntil > now) snoozed.set(r.itemKey, r.snoozedUntil);
  }
  return { snoozed, done };
}

/** The ids of one kind among a set of keys ("task:a" -> "a"). */
export function idsOfKind(keys: Iterable<string>, kind: string): string[] {
  const prefix = `${kind}:`;
  const out: string[] = [];
  for (const k of keys) if (k.startsWith(prefix)) out.push(k.slice(prefix.length));
  return out;
}
