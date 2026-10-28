import { createHash } from "node:crypto";

import { AppError } from "@/server/db/errors";

/**
 * The list tools' cursors (docs/features/ai-connectors.md): opaque to the
 * AI app, base64url JSON underneath. A cursor names where the next page
 * starts (an offset, or a database's own keyset position) and the list it
 * belongs to: a fingerprint of the tool and its filters, so a cursor from
 * one list is refused by another instead of paging through the wrong rows.
 */

export class CursorError extends AppError {
  constructor() {
    super(
      "That cursor belongs to a different list. Call the tool again without a cursor to start over.",
      400,
      "CONNECTOR_CURSOR",
    );
    this.name = "CursorError";
  }
}

/** Where the next page starts. */
export interface CursorPosition {
  /** Rows already returned. */
  offset: number;
  /** A keyset position the backing query hands out (club-made databases). */
  after?: string;
}

interface Payload {
  v: 1;
  /** The list's fingerprint. */
  s: string;
  o: number;
  a?: string;
}

/** The largest offset a cursor may carry: well past any list a member can page through. */
const MAX_OFFSET = 100_000;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonical(v)]),
    );
  }
  return value;
}

/** The list a page belongs to: the tool and every argument that shapes it (not the page size). */
export function listFingerprint(tool: string, filters: Record<string, unknown>): string {
  return createHash("sha256")
    .update(JSON.stringify([tool, canonical(filters)]))
    .digest("base64url")
    .slice(0, 16);
}

export function encodeCursor(list: string, position: CursorPosition): string {
  const payload: Payload = { v: 1, s: list, o: position.offset };
  if (position.after) payload.a = position.after;
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

/** The start of the list without a cursor; throws CursorError for one from another list. */
export function decodeCursor(cursor: string | undefined, list: string): CursorPosition {
  if (!cursor) return { offset: 0 };
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new CursorError();
  }
  const p = payload as Partial<Payload> | null;
  if (
    !p ||
    p.v !== 1 ||
    p.s !== list ||
    typeof p.o !== "number" ||
    !Number.isInteger(p.o) ||
    p.o < 0 ||
    p.o > MAX_OFFSET ||
    (p.a !== undefined && (typeof p.a !== "string" || p.a.length > 200))
  ) {
    throw new CursorError();
  }
  return p.a ? { offset: p.o, after: p.a } : { offset: p.o };
}

/**
 * One page of rows read with `take: limit + 1`: the first `limit`, and a
 * cursor for the rest when there was one more.
 */
export function pageOf<T>(
  rows: readonly T[],
  limit: number,
  list: string,
  position: CursorPosition,
): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  return {
    items,
    nextCursor:
      rows.length > limit ? encodeCursor(list, { offset: position.offset + limit }) : null,
  };
}
