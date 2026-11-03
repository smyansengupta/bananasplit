import { NewCard, type NewCardWith } from "@/components/crm/cards/new-card";
import { withOrgTx } from "@/server/db/context";

import type { OverlayProps } from "./crm-overlays";

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * New person, company or deal (?open=new:person|company|deal,
 * NewRecord.dc.html). `?with=` brings what it starts with: a company
 * (`company:<id>`, Add a person here) or the people or companies picked on
 * People (`person:<id>,<id>`, Start a deal).
 */
export async function NewOverlay({ shell, open, searchParams }: OverlayProps<"new">) {
  const orgId = shell.org.id;
  const raw = typeof searchParams.with === "string" ? searchParams.with : "";
  const [head, rest] = raw.split(":", 2) as [string, string | undefined];
  const ids = (rest ?? "").split(",").filter((v) => ID.test(v)).slice(0, 20);
  const start: NewCardWith = await withOrgTx(orgId, async ({ db }) => {
    if (!ids.length) return { company: null, people: [] };
    if (head === "company") {
      const c = await db.crmCompany.findFirst({
        where: { organizationId: orgId, id: ids[0], deletedAt: null },
        select: { id: true, name: true },
      });
      return { company: c ? { id: c.id, label: c.name } : null, people: [] };
    }
    if (head === "person") {
      const rows = await db.crmPerson.findMany({
        where: { organizationId: orgId, id: { in: ids }, deletedAt: null },
        select: { id: true, name: true, company: { select: { id: true, name: true } } },
      });
      const people = ids
        .map((id) => rows.find((r) => r.id === id))
        .filter((r): r is (typeof rows)[number] => Boolean(r));
      const companies = new Set(people.map((p) => p.company?.id).filter(Boolean));
      const only = companies.size === 1 ? people.find((p) => p.company)?.company : null;
      return {
        company: only ? { id: only.id, label: only.name } : null,
        people: people.map((p) => ({ id: p.id, label: p.name })),
      };
    }
    return { company: null, people: [] };
  });
  const others = shell.members.filter((m) => m.id !== shell.user.id);
  return (
    <NewCard
      orgId={orgId}
      what={open.what}
      start={start}
      viewerId={shell.user.id}
      owners={others.slice(0, 6).map((m) => ({ id: m.id, label: m.name.split(" ")[0] ?? m.name }))}
      pipelines={shell.pipelines.map((p) => ({
        id: p.id,
        name: p.name,
        stages: p.stages.filter((s) => s.kind !== "LOST").map((s) => ({ id: s.id, name: s.name })),
      }))}
      relationships={(shell.access.settings?.relationshipTypes ?? []).map((t) => ({
        id: t.id,
        label: t.label,
      }))}
    />
  );
}
