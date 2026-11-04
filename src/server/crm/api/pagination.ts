/**
 * Cursor pagination for the public API: newest first by (createdAt, id),
 * the cursor being the last row's pair, opaque to the caller. Stable while
 * rows are added, cheap on the (organizationId, ...) indexes, and with no
 * page numbers to drift. Pure.
 */

export interface Cursor {
  createdAt: Date;
  id: string;
}

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

export function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify([row.createdAt.toISOString(), row.id]), "utf8").toString("base64url");
}

export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw) return null;
  if (raw.length > 200 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new CursorError();
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 2) throw new CursorError();
    const [at, id] = parsed as [unknown, unknown];
    const createdAt = new Date(String(at));
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(id) || Number.isNaN(createdAt.getTime())) {
      throw new CursorError();
    }
    return { createdAt, id };
  } catch (error) {
    if (error instanceof CursorError) throw error;
    throw new CursorError();
  }
}

export class CursorError extends Error {
  constructor() {
    super("That cursor isn't one we gave out.");
    this.name = "CursorError";
  }
}

/** The rows after the cursor, newest first. */
export function afterCursor(cursor: Cursor | null): Record<string, unknown> {
  if (!cursor) return {};
  return {
    OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }],
  };
}

export const NEWEST_FIRST = [{ createdAt: "desc" as const }, { id: "desc" as const }];

export function parseLimit(raw: string | null | undefined): number {
  if (raw === null || raw === undefined || raw === "") return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

/** Fetch limit + 1, then split: the page, whether there's more, and the next cursor. */
export function page<T extends { createdAt: Date; id: string }>(
  rows: readonly T[],
  limit: number,
): { rows: T[]; hasMore: boolean; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const last = pageRows[pageRows.length - 1];
  return { rows: pageRows, hasMore, nextCursor: hasMore && last ? encodeCursor(last) : null };
}
