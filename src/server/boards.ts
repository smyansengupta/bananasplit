import { Prisma } from "@/generated/prisma/client";
import { boardInputSchema } from "@/lib/boards";
import type { TxClient } from "@/server/db/context";

/**
 * A member's own boards (MemberPrefs, owner-only under RLS): the Overview
 * and the Finance dashboard. Nothing here is shared: one member's layout
 * never changes another's.
 */

export type BoardName = "overview" | "finance";

const COLUMN = { overview: "overviewWidgets", finance: "financeWidgets" } as const;

/** The saved layout (unparsed), or null when the member never customized it. */
export async function loadSavedBoard(
  db: TxClient,
  organizationId: string,
  userId: string,
  board: BoardName,
): Promise<unknown> {
  const row = await db.memberPrefs.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { overviewWidgets: true, financeWidgets: true },
  });
  return row?.[COLUMN[board]] ?? null;
}

export type SaveBoardResult = { ok: true } | { ok: false; error: string };

/** Saves a board of known widget types; null puts the default back. */
export async function saveBoard(
  db: TxClient,
  organizationId: string,
  userId: string,
  board: BoardName,
  raw: unknown,
  types: readonly string[],
): Promise<SaveBoardResult> {
  let value: Prisma.InputJsonValue | typeof Prisma.DbNull = Prisma.DbNull;
  if (raw !== null) {
    const parsed = boardInputSchema.safeParse(raw);
    const known = new Set(types);
    if (
      !parsed.success ||
      parsed.data.some((w) => !known.has(w.type)) ||
      new Set(parsed.data.map((w) => w.id)).size !== parsed.data.length
    ) {
      return { ok: false, error: "That layout couldn't be saved." };
    }
    value = parsed.data as unknown as Prisma.InputJsonValue;
  }
  const column = COLUMN[board];
  await db.memberPrefs.upsert({
    where: { organizationId_userId: { organizationId, userId } },
    create: { organizationId, userId, [column]: value },
    update: { [column]: value },
  });
  return { ok: true };
}
