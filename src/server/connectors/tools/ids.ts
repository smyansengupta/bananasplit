import { NotFoundError } from "@/lib/auth/errors";

/**
 * Item ids the tools hand out (docs/features/ai-connectors.md): opaque to
 * the AI app, `<kind>:<spaceId>:<id>` underneath, so one id is enough for
 * fetch and the get_ tools to find the space to open. Space ids are the
 * org ids list_spaces returns. A database's id part is its URL key.
 *
 * Decoding only reads the shape. The tool still opens the space through
 * withConnectorOrgTx (membership, the club switch, the grant's scope) and
 * looks the item up with organizationId in the same query, so a forged id
 * finds nothing.
 */

export const ITEM_KINDS = [
  "note",
  "task",
  "event",
  "poll",
  "person",
  "database",
  "expense",
] as const;

export type ItemKind = (typeof ITEM_KINDS)[number];

export interface ItemRef {
  kind: ItemKind;
  spaceId: string;
  id: string;
}

/** cuids, our org ids and database keys; never a colon. */
const PART = /^[A-Za-z0-9_-]{1,128}$/;

function isKind(value: string): value is ItemKind {
  return (ITEM_KINDS as readonly string[]).includes(value);
}

export function itemId(kind: ItemKind, spaceId: string, id: string): string {
  if (!PART.test(spaceId) || !PART.test(id)) {
    throw new TypeError(`itemId: ${kind} ids are letters, digits, _ and -`);
  }
  return `${kind}:${spaceId}:${id}`;
}

/** The parts of an id itemId made, or null for anything else. */
export function parseItemId(value: string): ItemRef | null {
  const parts = value.trim().split(":");
  if (parts.length !== 3) return null;
  const [kind, spaceId, id] = parts as [string, string, string];
  if (!isKind(kind) || !PART.test(spaceId) || !PART.test(id)) return null;
  return { kind, spaceId, id };
}

/** Whether `value` is shaped like a space id (list_spaces), checked before any query. */
export function isSpaceId(value: string): boolean {
  return PART.test(value);
}

/**
 * The item `value` names when it is one of `kinds`; NotFoundError for
 * anything else, the same answer as an id that isn't there.
 */
export function refOf(value: string, ...kinds: ItemKind[]): ItemRef {
  const ref = parseItemId(value);
  if (!ref || !kinds.includes(ref.kind)) throw new NotFoundError();
  return ref;
}

/**
 * A member argument: "me", or a person id from this space (list_members).
 * Null for anything else.
 */
export function memberOf(value: string, spaceId: string, me: string): string | null {
  if (value.trim().toLowerCase() === "me") return me;
  const ref = parseItemId(value);
  return ref?.kind === "person" && ref.spaceId === spaceId ? ref.id : null;
}
