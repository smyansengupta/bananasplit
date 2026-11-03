import { CrmAiBar } from "@/components/crm/ai/ai-bar";
import { ReviewQueue, type QueueItemView } from "@/components/crm/ai/review-queue";
import { CrmTabs } from "@/components/crm/crm-tabs";
import { PageHeader } from "@/components/page-header";
import { QUEUE_KINDS } from "@/lib/crm/suggestions";
import { listQueue } from "@/server/crm/review";
import { withOrgTx } from "@/server/db/context";

import { crmShell } from "../shell";

export const metadata = { title: "Review" };

/**
 * The CRM's review queue: what AI, connected apps, automations and email
 * suggest, waiting for a person to accept or reject (docs/features/crm.md,
 * differentiator 6). Duplicates keep their own tab.
 */
export default async function CrmQueuePage({ params, searchParams }: PageProps<"/app/[orgSlug]/crm/queue">) {
  const { orgSlug } = await params;
  const sp = (await searchParams) as Record<string, string | undefined>;
  const { gate, shell } = await crmShell(orgSlug);
  if (!shell) return gate;
  const orgId = shell.org.id;
  const status = sp.status === "done" ? "done" : "waiting";
  const mine = sp.mine === "1";
  const names = new Map(shell.members.map((m) => [m.id, m.name]));
  const data = await withOrgTx(orgId, async ({ db }) => {
    const items = await listQueue(db, orgId, shell.user.id, { status: status === "done" ? "DONE" : "PENDING", mine });
    const waiting = await db.crmSuggestion.count({ where: { organizationId: orgId, status: "PENDING", kind: { in: [...QUEUE_KINDS] } } });
    const forMe = await db.crmSuggestion.count({
      where: { organizationId: orgId, status: "PENDING", kind: { in: [...QUEUE_KINDS] }, assigneeId: shell.user.id },
    });
    return { items, waiting, forMe };
  });
  const views: QueueItemView[] = data.items.map((i) => ({
    id: i.id,
    kind: i.kind,
    source: i.source,
    status: i.status,
    title: i.title,
    summary: i.summary,
    rows: i.rows,
    target: i.target,
    citation: i.citation,
    assignee: i.assigneeId ? (names.get(i.assigneeId) ?? null) : null,
    proposedBy: i.proposedById ? (names.get(i.proposedById) ?? null) : null,
    reviewedBy: i.reviewedById ? (names.get(i.reviewedById) ?? null) : null,
    at: (i.reviewedAt ?? i.createdAt).toISOString(),
    undoable: i.undoable,
    edit:
      i.kind === "DRAFT_EMAIL"
        ? { subject: String(i.payload.subject ?? ""), body: String(i.payload.body ?? "") }
        : i.kind === "CREATE_TASK"
          ? { title: String(i.payload.title ?? ""), dueDate: typeof i.payload.dueDate === "string" ? i.payload.dueDate : null }
          : null,
  }));
  return (
    <div className="space-y-6">
      <PageHeader
        title="Review"
        description="Nothing AI or a connected app suggests changes the CRM until someone accepts it."
        tabs={<CrmTabs tabs={shell.tabs} />}
      />
      <CrmAiBar orgId={orgId} orgSlug={orgSlug} />
      <ReviewQueue orgId={orgId} orgSlug={orgSlug} items={views} status={status} mine={mine} counts={{ waiting: data.waiting, mine: data.forMe }} />
    </div>
  );
}
