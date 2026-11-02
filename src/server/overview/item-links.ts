import type { LinkKind } from "@/lib/links";
import type { TxClient } from "@/server/db/context";
import { readLinks } from "@/server/links/links";

/**
 * Which of `ids` (things of `kind`) are linked to things of `otherKind`,
 * through ItemLink in either direction: a map from each id to the ids it is
 * linked to. How Home's widgets know that a task is for an event, or a
 * reimbursement for a task. Only the link rows are read here (readLinks);
 * the other ends are looked up by the caller as the viewer, so a thing they
 * can't see never shows up.
 */
export async function linkedTo(
  db: TxClient,
  organizationId: string,
  kind: LinkKind,
  ids: readonly string[],
  otherKind: LinkKind,
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const ends = await readLinks(
    db,
    organizationId,
    ids.map((id) => ({ kind, id })),
    { otherKinds: [otherKind], take: 1000 },
  );
  for (const { at, other } of ends) {
    const mine = at.slice(kind.length + 1);
    const list = out.get(mine) ?? [];
    if (!list.includes(other.id)) list.push(other.id);
    out.set(mine, list);
  }
  return out;
}
