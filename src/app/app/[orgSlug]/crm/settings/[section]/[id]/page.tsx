import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { SettingsCard } from "@/app/app/[orgSlug]/settings/settings-card";
import { CrmSettingsFrame } from "@/components/crm/settings/settings-frame";
import { RunLog, WorkflowBuilder, type BuilderDraft } from "@/components/crm/workflow-builder";
import { Badge } from "@/components/ui/badge";
import { crmRecordHref } from "@/lib/crm/href";
import {
  canOpenSection,
  crmSettingsHref,
  defaultSection,
  findSection,
} from "@/lib/crm/settings-sections";
import { readWorkflow } from "@/lib/crm/workflows";
import { builderContext } from "@/server/crm/builder-context";
import { workflowRuns } from "@/server/crm/workflows";
import { withOrgTx } from "@/server/db/context";

import { crmSettingsShell } from "../../../shell";

export const metadata = { title: "CRM settings" };

const NEW: BuilderDraft = {
  name: "",
  trigger: { type: "record.created", params: { object: "person" } },
  conditions: [],
  actions: [
    {
      type: "task.create",
      params: { title: "Say hello to {{name}}", dueInDays: 2, assignTo: "owner" },
    },
  ],
};

const STATUS_WORD = {
  RUNNING: "Running",
  DONE: "Done",
  FAILED: "Failed",
  SKIPPED: "Skipped",
} as const;
const EVENT_WORD: Record<string, string> = {
  "record.changed": "A change",
  "form.submitted": "A form answer",
  "email.replied": "A reply",
  "meeting.booked": "A booking",
  "date.reached": "The date",
  "no.activity": "A quiet spell",
  "deal.stuck": "Stuck",
  "dry-run": "Tried",
};

/**
 * A page under a CRM settings section: one automation
 * (/crm/settings/automations/{id}, or new, with ?describe= from the
 * describe box) with its run history. A booking page's old address
 * (/crm/settings/booking/{id}) opens it in Meetings > Booking links.
 */
export default async function CrmSettingsItemPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/crm/settings/[section]/[id]">) {
  const { orgSlug, section: sectionId, id } = await params;
  // A booking page opens in Meetings > Booking links now (docs/features/booking.md).
  if (findSection(sectionId)?.id === "booking") redirect(crmSettingsHref(orgSlug, "booking", `/${id}`));
  const sp = (await searchParams) as Record<string, string | undefined>;
  const { gate, shell } = await crmSettingsShell(orgSlug);
  if (!shell) return gate;
  const section = findSection(sectionId);
  if (!section || section.id !== "automations") notFound();
  const viewer = {
    admin: shell.access.admin,
    manager: shell.access.manager,
    personal: shell.access.personal,
  };
  if (!canOpenSection(section, viewer)) redirect(crmSettingsHref(orgSlug, defaultSection(viewer)));
  const orgId = shell.org.id;
  const back = { href: crmSettingsHref(orgSlug, section.id), label: section.label };

  const isNew = id === "new";
  const data = await withOrgTx(orgId, async ({ db }) => {
    const ctx = await builderContext(db, orgId);
    if (isNew) return { ctx, row: null, runs: [] };
    const row = await db.crmWorkflow.findFirst({ where: { id, organizationId: orgId } });
    if (!row) return null;
    return { ctx, row, runs: await workflowRuns(db, orgId, row.id) };
  });
  if (!data) notFound();
  const parsed = data.row ? readWorkflow(data.row) : null;
  const initial: BuilderDraft =
    data.row && parsed?.trigger
      ? {
          name: data.row.name,
          trigger: parsed.trigger,
          conditions: parsed.conditions,
          actions: parsed.actions,
        }
      : { ...NEW, ...(data.row ? { name: data.row.name } : {}) };
  const describe =
    isNew && sp.describe && sp.describe !== "1" ? sp.describe.slice(0, 1000) : undefined;
  return (
    <CrmSettingsFrame
      orgSlug={orgSlug}
      viewer={viewer}
      section={section}
      back={back}
      title={data.row ? data.row.name : "New automation"}
      description={
        data.row?.described
          ? `Described as: "${data.row.described}"`
          : "When this happens, if this holds, then do this."
      }
    >
      <WorkflowBuilder
        orgId={orgId}
        orgSlug={orgSlug}
        workflowId={data.row?.id ?? null}
        initial={initial}
        status={data.row?.status ?? "DRAFT"}
        ctx={data.ctx}
        describeFirst={sp.describe === "1"}
        describeText={describe}
      />
      {data.row && (
        <SettingsCard title="Run history" description="What it did, newest first.">
          {data.runs.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              It hasn&apos;t run yet. Try it to see what it would do.
            </p>
          ) : (
            <ol className="space-y-4">
              {data.runs.map((r) => (
                <li key={r.id} className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge
                      variant={
                        r.status === "FAILED"
                          ? "destructive"
                          : r.dryRun
                            ? "outline"
                            : r.status === "DONE"
                              ? "success"
                              : "secondary"
                      }
                    >
                      {r.dryRun ? "Tried" : STATUS_WORD[r.status]}
                    </Badge>
                    {r.target?.name ? (
                      <Link
                        href={crmRecordHref(
                          orgSlug,
                          r.target.kind as "person" | "company" | "deal",
                          r.target.id,
                        )}
                        className="font-medium hover:underline"
                      >
                        {r.target.name}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">A removed record</span>
                    )}
                    <span className="text-muted-foreground ms-auto text-xs">
                      {r.event ? `${EVENT_WORD[r.event] ?? "An event"}, ` : ""}
                      {r.startedAt.toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                        timeZone: shell.org.timezone ?? "UTC",
                      })}
                    </span>
                  </div>
                  <RunLog log={r.log} />
                </li>
              ))}
            </ol>
          )}
        </SettingsCard>
      )}
    </CrmSettingsFrame>
  );
}
