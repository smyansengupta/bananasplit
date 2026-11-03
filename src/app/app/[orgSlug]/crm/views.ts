import type { TxClient } from "@/server/db/context";

/**
 * Saved views (CrmView) as links: a view's filters are written in the
 * database view grammar ({col, op, value}); the lists read them as their
 * own URL parameters. A view is a list (Phase 2's campaigns start from one).
 */

const PARAM: Record<string, (op: string, value: string) => [string, string] | null> = {
  owner: (_op, v) => ["owner", v],
  followUp: (op) => (op === "lte" ? ["due", "due"] : null),
  relationship: (_op, v) => ["rel", v],
  status: (_op, v) => ["status", v],
};

export async function savedViews(
  db: TxClient,
  organizationId: string,
  objectKind: "people" | "companies" | "deals",
  base: string,
  current: URLSearchParams,
): Promise<{ name: string; href: string; active: boolean }[]> {
  const rows = await db.crmView.findMany({
    where: { organizationId, objectKind },
    orderBy: { createdAt: "asc" },
    take: 12,
    select: { name: true, filters: true },
  });
  return rows.map((r) => {
    const params = new URLSearchParams();
    for (const f of (Array.isArray(r.filters) ? r.filters : []) as { col?: string; op?: string; value?: string }[]) {
      const hit = f.col && PARAM[f.col]?.(f.op ?? "eq", String(f.value ?? ""));
      if (hit) params.set(hit[0], hit[1]);
    }
    const qs = params.toString();
    const active =
      qs !== "" && [...params.entries()].every(([k, v]) => current.get(k) === v) &&
      [...current.keys()].filter((k) => !["page", "q", "sort", "dir"].includes(k)).length === [...params.keys()].length;
    return { name: r.name, href: qs ? `${base}?${qs}` : base, active };
  });
}

export function toSearch(sp: Record<string, string | string[] | undefined>): URLSearchParams {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") out.set(k, v);
  return out;
}
