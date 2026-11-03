import { notFound } from "next/navigation";

import { BackLink } from "@/components/back-link";
import { CrmTabs } from "@/components/crm/crm-tabs";
import { SequenceEditor } from "@/components/crm/outreach/sequences";
import { PageHeader } from "@/components/page-header";
import { readWindow } from "@/lib/crm/outreach/schedule";
import { withOrgTx } from "@/server/db/context";

import { crmShell } from "../../../shell";

export const metadata = { title: "Sequence" };

function inDays(at: Date | null): string | null {
  if (!at) return null;
  const days = Math.round((at.getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

export default async function SequencePage({ params }: PageProps<"/app/[orgSlug]/crm/outreach/sequences/[sequenceId]">) {
  const { orgSlug, sequenceId } = await params;
  const { gate, shell } = await crmShell(orgSlug);
  if (!shell) return gate;
  const orgId = shell.org.id;
  const names = new Map(shell.members.map((m) => [m.id, m.name]));
  const data = await withOrgTx(orgId, async ({ db }) => {
    const seq = await db.crmSequence.findFirst({
      where: { id: sequenceId, organizationId: orgId, archivedAt: null },
      include: { steps: { orderBy: { sortOrder: "asc" } } },
    });
    if (!seq) return null;
    const templates = await db.crmTemplate.findMany({
      where: { organizationId: orgId, archivedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
      take: 50,
    });
    const enrollments = await db.crmEnrollment.findMany({
      where: { organizationId: orgId, sequenceId: seq.id },
      orderBy: [{ status: "asc" }, { startedAt: "desc" }],
      take: 300,
      select: { id: true, personId: true, status: true, nextStep: true, nextRunAt: true, senderId: true, stopReason: true, person: { select: { name: true } } },
    });
    const org = await db.organization.findUnique({ where: { id: orgId }, select: { timezone: true } });
    return { seq, templates, enrollments, tz: org?.timezone ?? "UTC" };
  });
  if (!data) notFound();
  const { seq } = data;
  return (
    <div className="space-y-6">
      <PageHeader title={seq.name} tabs={<CrmTabs tabs={shell.tabs} />} />
      <BackLink href={`/app/${orgSlug}/crm/outreach/sequences`} label="Sequences" />
      <SequenceEditor
        orgId={orgId}
        orgSlug={orgSlug}
        tz={data.tz}
        templates={data.templates}
        sequence={{
          id: seq.id,
          name: seq.name,
          status: seq.status,
          stopOnReply: seq.stopOnReply,
          stopOnBooking: seq.stopOnBooking,
          window: readWindow(seq.sendWindow),
          steps: seq.steps.map((s) => ({
            kind: s.kind,
            delayDays: s.delayDays,
            delayHours: s.delayHours,
            subject: s.subject ?? "",
            body: s.body ?? "",
            templateId: s.templateId,
            taskTitle: s.taskTitle ?? "",
          })),
        }}
        enrollments={data.enrollments.map((e) => ({
          id: e.id,
          personId: e.personId,
          name: e.person.name,
          status: e.status,
          step: e.nextStep,
          next: inDays(e.nextRunAt),
          sender: names.get(e.senderId) ?? "A former member",
          reason: e.stopReason,
        }))}
      />
    </div>
  );
}
