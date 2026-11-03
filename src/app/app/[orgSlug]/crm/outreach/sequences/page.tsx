import { OutreachHeader } from "@/components/crm/outreach/outreach-header";
import { SequencesList } from "@/components/crm/outreach/sequences";
import { withOrgTx } from "@/server/db/context";

import { crmShell } from "../../shell";

export const metadata = { title: "Sequences" };

export default async function SequencesPage({ params }: PageProps<"/app/[orgSlug]/crm/outreach/sequences">) {
  const { orgSlug } = await params;
  const { gate, shell } = await crmShell(orgSlug);
  if (!shell) return gate;
  const orgId = shell.org.id;
  const sequences = await withOrgTx(orgId, async ({ db }) => {
    const rows = await db.crmSequence.findMany({
      where: { organizationId: orgId, archivedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: { id: true, name: true, status: true, _count: { select: { steps: true } } },
    });
    const counts = await db.crmEnrollment.groupBy({
      by: ["sequenceId", "status"],
      where: { organizationId: orgId, sequenceId: { in: rows.map((r) => r.id) } },
      _count: { _all: true },
    });
    const n = (id: string, s: string[]) =>
      counts.filter((c) => c.sequenceId === id && s.includes(c.status)).reduce((a, c) => a + c._count._all, 0);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      steps: r._count.steps,
      active: n(r.id, ["ACTIVE", "PAUSED"]),
      replied: n(r.id, ["REPLIED", "BOOKED"]),
      finished: n(r.id, ["FINISHED", "STOPPED", "BOUNCED", "UNSUBSCRIBED"]),
    }));
  });
  return (
    <div className="space-y-6">
      <OutreachHeader
        orgSlug={orgSlug}
        tabs={shell.tabs}
        view="sequences"
        title="Sequences"
        description="Timed steps that stop the moment they reply, book or unsubscribe."
      />
      <SequencesList orgId={orgId} orgSlug={orgSlug} sequences={sequences} />
    </div>
  );
}
