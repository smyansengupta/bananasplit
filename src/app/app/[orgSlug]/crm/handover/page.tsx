import Link from "next/link";

import { CrmTabs } from "@/components/crm/crm-tabs";
import { HandOverCard, Unowned } from "@/components/crm/outreach/handover";
import { PageHeader } from "@/components/page-header";
import { Segmented } from "@/components/ui/segmented";
import { briefs, departedOwners, unowned } from "@/server/crm/outreach/handover";
import { withOrgTx } from "@/server/db/context";

import { crmShell } from "../shell";

export const metadata = { title: "Handover" };

/**
 * Handover (docs/features/crm.md, "What makes ours better" 5): for
 * managers, members who left (or anyone) and the people they looked after,
 * handed over in one step, and everyone left with no owner; for anyone,
 * the brief on each person they've taken over (?for=me) or that their
 * position looks after (?role=).
 */
export default async function HandoverPage({ params, searchParams }: PageProps<"/app/[orgSlug]/crm/handover">) {
  const { orgSlug } = await params;
  const sp = (await searchParams) as Record<string, string | undefined>;
  const { gate, shell } = await crmShell(orgSlug);
  if (!shell) return gate;
  const orgId = shell.org.id;
  const userId = shell.user.id;
  const manager = shell.access.manager;
  const role = sp.role && shell.roles.has(sp.role) ? sp.role : null;
  const view = role ? "role" : manager && sp.for !== "me" ? "manage" : "mine";
  const names = new Map(shell.members.map((m) => [m.id, m.name]));
  const data = await withOrgTx(orgId, async ({ db }) => {
    if (view === "manage") {
      const left = await departedOwners(db, orgId);
      const counts = await db.crmPerson.groupBy({
        by: ["ownerId"],
        where: { organizationId: orgId, deletedAt: null, ownerId: { in: shell.members.map((m) => m.id) } },
        _count: { _all: true },
      });
      return {
        left,
        members: counts.map((c) => ({ userId: c.ownerId!, name: names.get(c.ownerId!) ?? "A member", people: c._count._all })),
        unowned: await unowned(db, orgId, shell.roles),
        briefs: [],
      };
    }
    // Mine: people handed to me in the last 90 days (field history), or my position's.
    let where;
    if (role) where = { ownerRoleKey: role };
    else {
      const handed = await db.crmFieldHistory.findMany({
        where: {
          organizationId: orgId,
          targetKind: "person",
          field: "ownerId",
          newValue: { equals: userId },
          changedAt: { gte: new Date(Date.now() - 90 * 86_400_000) },
        },
        select: { targetId: true },
        take: 500,
      });
      where = { id: { in: [...new Set(handed.map((h) => h.targetId))] }, ownerId: userId };
    }
    return { left: [], members: [], unowned: [], briefs: await briefs(db, orgId, where) };
  });
  const choices = [
    ...shell.members.map((m) => ({ value: `u:${m.id}`, label: m.name })),
    ...[...shell.roles.values()].map((r) => ({ value: `r:${r.key}`, label: `${r.title} (${r.holderName?.split(" ")[0] ?? "open"})` })),
  ];
  const base = `/app/${orgSlug}/crm/handover`;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Handover"
        description={
          view === "role"
            ? `What ${shell.roles.get(role!)?.title ?? "this position"} looks after, with a brief on each.`
            : view === "mine"
              ? "People handed to you, with what you need before you write."
              : "When someone leaves or changes role, their relationships move in one step."
        }
        tabs={<CrmTabs tabs={shell.tabs} />}
      />
      {manager && (
        <Segmented
          label="Handover"
          value={view === "manage" ? "manage" : "mine"}
          options={[
            { value: "manage", label: "Hand over", href: base },
            { value: "mine", label: "Handed to me", href: `${base}?for=me` },
          ]}
        />
      )}
      {view === "manage" ? (
        <div className="space-y-8">
          {data.left.length > 0 && (
            <section className="space-y-3">
              <h2 className="heading text-lg">Members who left</h2>
              <ul className="grid gap-3 md:grid-cols-2">
                {data.left.map((l) => (
                  <HandOverCard key={l.userId} orgId={orgId} from={{ ...l, left: true }} choices={choices} />
                ))}
              </ul>
            </section>
          )}
          <section className="space-y-3">
            <h2 className="heading text-lg">No owner</h2>
            <Unowned orgId={orgId} orgSlug={orgSlug} rows={data.unowned} choices={choices} />
          </section>
          {data.members.length > 0 && (
            <section className="space-y-3">
              <h2 className="heading text-lg">Changing roles</h2>
              <p className="text-muted-foreground text-sm">Hand someone's relationships to whoever takes over, or to a position so they follow it.</p>
              <ul className="grid gap-3 md:grid-cols-2">
                {data.members.map((m) => (
                  <HandOverCard key={m.userId} orgId={orgId} from={{ ...m, left: false }} choices={choices} />
                ))}
              </ul>
            </section>
          )}
        </div>
      ) : data.briefs.length === 0 ? (
        <p className="text-muted-foreground text-[15px]">Nobody has been handed to you lately.</p>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {data.briefs.map((b) => (
            <li key={b.id} className="bg-card ring-foreground/6 rounded-card space-y-2 p-5 ring-1">
              <Link href={`/app/${orgSlug}/crm/people/${b.id}`} className="heading text-[15px] hover:underline">
                {b.name}
              </Link>
              {b.lines.map((l, i) => (
                <p key={i} className="text-sm">
                  {l}
                </p>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
