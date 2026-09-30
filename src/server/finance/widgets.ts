import { Prisma } from "@/generated/prisma/client";
import type { FinanceCardId } from "@/lib/finance/dashboard-cards";
import { layoutSchema, resolveLayout, type Widget } from "@/lib/finance/widgets";
import type { TxClient } from "@/server/db/context";

/**
 * A member's own finance board (MemberPrefs.financeWidgets, owner-only under
 * RLS). Nothing here is shared: one treasurer's layout never changes
 * another's.
 */

export async function loadFinanceLayout(
  db: TxClient,
  organizationId: string,
  userId: string,
  orgCards: ReadonlySet<FinanceCardId>,
): Promise<{ layout: Widget[]; customized: boolean }> {
  const row = await db.memberPrefs.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { financeWidgets: true },
  });
  const saved = row?.financeWidgets ?? null;
  return { layout: resolveLayout(saved, orgCards), customized: saved !== null };
}

export type SaveLayoutResult = { ok: true } | { ok: false; error: string };

/** Saves the board; null puts the default back. */
export async function saveFinanceLayout(
  db: TxClient,
  organizationId: string,
  userId: string,
  raw: unknown,
): Promise<SaveLayoutResult> {
  let value: Prisma.InputJsonValue | typeof Prisma.DbNull;
  if (raw === null) {
    value = Prisma.DbNull;
  } else {
    const parsed = layoutSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: "That layout couldn't be saved." };
    const ids = new Set(parsed.data.map((w) => w.id));
    if (ids.size !== parsed.data.length) return { ok: false, error: "That layout couldn't be saved." };
    value = parsed.data as unknown as Prisma.InputJsonValue;
  }
  await db.memberPrefs.upsert({
    where: { organizationId_userId: { organizationId, userId } },
    create: { organizationId, userId, financeWidgets: value },
    update: { financeWidgets: value },
  });
  return { ok: true };
}
