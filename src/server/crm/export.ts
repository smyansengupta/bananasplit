import { displayText, type FieldDef } from "@/lib/databases/fields";
import { STATUS_LABELS, type RecordStatus } from "@/lib/crm/fields";
import { toCsv } from "@/lib/csv";
import type { TxClient } from "@/server/db/context";

import { customFieldsFor } from "./databases";
import { rolePositions, ownerLabel } from "./owners";

/**
 * Export everything to CSV, the timeline included (docs/features/crm.md:
 * "export includes the timeline"), as the viewer can see it (RLS). People,
 * companies and one pipeline's items each come out with their custom
 * fields; the timeline export has one row per activity per record it's on,
 * so it imports straight into another CRM.
 */

export type ExportKind = "people" | "companies" | "items" | "timeline";

const MAX_ROWS = 100_000;

function iso(d: Date | null | undefined): string {
  return d ? d.toISOString() : "";
}

function day(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

async function memberNames(db: TxClient, organizationId: string): Promise<Map<string, string>> {
  const rows = await db.membership.findMany({
    where: { organizationId },
    select: { userId: true, user: { select: { name: true } } },
  });
  return new Map(rows.map((r) => [r.userId, r.user.name ?? "Member"]));
}

function customCells(fields: readonly FieldDef[], custom: unknown, names: ReadonlyMap<string, string>): string[] {
  const values = (custom ?? {}) as Record<string, unknown>;
  return fields.map((f) => displayText(f, values[f.id], names));
}

export async function exportCsv(
  db: TxClient,
  organizationId: string,
  kind: ExportKind,
  options: { pipelineId?: string | null } = {},
): Promise<{ csv: string; rows: number; fileName: string }> {
  const names = await memberNames(db, organizationId);
  const roles = await rolePositions(organizationId);
  if (kind === "people") {
    const fields = await customFieldsFor(db, organizationId, "person");
    const rows = await db.crmPerson.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: { name: "asc" },
      take: MAX_ROWS,
      include: { company: { select: { name: true } }, emails: { select: { email: true, isPrimary: true } } },
    });
    const header = [
      "Name",
      "First name",
      "Last name",
      "Email",
      "Other emails",
      "Phone",
      "Title",
      "Company",
      "LinkedIn",
      "Website",
      "Location",
      "Relationship",
      "Status",
      "Owner",
      "Source",
      "Last contacted",
      "Next follow-up",
      "Keep in touch every (days)",
      "Do not contact",
      "Relationship strength",
      "Added",
      ...fields.map((f) => f.name),
    ];
    const data = rows.map((p) => [
      p.name,
      p.firstName ?? "",
      p.lastName ?? "",
      p.primaryEmail ?? "",
      p.emails.filter((e) => !e.isPrimary).map((e) => e.email).join("; "),
      p.phone ?? "",
      p.title ?? "",
      p.company?.name ?? "",
      p.linkedinUrl ?? "",
      p.website ?? "",
      p.location ?? "",
      p.relationship ?? "",
      STATUS_LABELS[p.status as RecordStatus],
      ownerLabel(p, roles, names) ?? "",
      p.source ?? "",
      day(p.lastContactedAt),
      day(p.nextFollowUpAt),
      p.keepInTouchDays ?? "",
      p.doNotContact ? "Yes" : "",
      p.strength,
      day(p.createdAt),
      ...customCells(fields, p.custom, names),
    ]);
    return { csv: toCsv(data, { header, bom: true }), rows: data.length, fileName: "crm-people.csv" };
  }
  if (kind === "companies") {
    const fields = await customFieldsFor(db, organizationId, "company");
    const rows = await db.crmCompany.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: { name: "asc" },
      take: MAX_ROWS,
    });
    const header = [
      "Name",
      "Domain",
      "Website",
      "Industry",
      "Size",
      "Phone",
      "Address",
      "About",
      "Status",
      "Owner",
      "Last contacted",
      "Next follow-up",
      "Relationship strength",
      "Added",
      ...fields.map((f) => f.name),
    ];
    const data = rows.map((c) => [
      c.name,
      c.domain ?? "",
      c.website ?? "",
      c.industry ?? "",
      c.size ?? "",
      c.phone ?? "",
      c.address ?? "",
      c.description ?? "",
      STATUS_LABELS[c.status as RecordStatus],
      ownerLabel(c, roles, names) ?? "",
      day(c.lastContactedAt),
      day(c.nextFollowUpAt),
      c.strength,
      day(c.createdAt),
      ...customCells(fields, c.custom, names),
    ]);
    return { csv: toCsv(data, { header, bom: true }), rows: data.length, fileName: "crm-companies.csv" };
  }
  if (kind === "items") {
    const pipeline = options.pipelineId
      ? await db.crmPipeline.findFirst({
          where: { id: options.pipelineId, organizationId },
          select: { id: true, name: true },
        })
      : null;
    const fields = pipeline ? await customFieldsFor(db, organizationId, "deal", pipeline.id) : [];
    const rows = await db.crmDeal.findMany({
      where: { organizationId, deletedAt: null, ...(pipeline ? { pipelineId: pipeline.id } : {}) },
      orderBy: { createdAt: "asc" },
      take: MAX_ROWS,
      include: {
        stage: { select: { name: true } },
        pipeline: { select: { name: true } },
        company: { select: { name: true } },
        people: { select: { person: { select: { name: true } } } },
      },
    });
    const header = [
      "Title",
      "Pipeline",
      "Stage",
      "Amount",
      "Currency",
      "Expected",
      "Company",
      "People",
      "Owner",
      "Next step",
      "Next step by",
      "Forecast",
      "Reason",
      "Source",
      "Closed",
      "Added",
      ...fields.map((f) => f.name),
    ];
    const data = rows.map((d) => [
      d.title,
      d.pipeline.name,
      d.stage.name,
      d.amountCents === null ? "" : (d.amountCents / 100).toFixed(2),
      d.currency,
      day(d.expectedOn),
      d.company?.name ?? "",
      d.people.map((p) => p.person.name).join("; "),
      ownerLabel(d, roles, names) ?? "",
      d.nextStep ?? "",
      day(d.nextStepAt),
      d.forecastCategory,
      d.closeReason ?? "",
      d.source ?? "",
      day(d.closedAt),
      day(d.createdAt),
      ...customCells(fields, d.custom, names),
    ]);
    const slug = (pipeline?.name ?? "items").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return { csv: toCsv(data, { header, bom: true }), rows: data.length, fileName: `crm-${slug}.csv` };
  }
  // The timeline: one row per activity per record.
  const people = new Map(
    (await db.crmPerson.findMany({ where: { organizationId }, select: { id: true, name: true, primaryEmail: true } })).map(
      (p) => [p.id, p],
    ),
  );
  const companies = new Map(
    (await db.crmCompany.findMany({ where: { organizationId }, select: { id: true, name: true } })).map((c) => [c.id, c]),
  );
  const deals = new Map(
    (await db.crmDeal.findMany({ where: { organizationId }, select: { id: true, title: true } })).map((d) => [d.id, d]),
  );
  const acts = await db.crmActivity.findMany({
    where: { organizationId, deletedAt: null },
    orderBy: { occurredAt: "asc" },
    take: MAX_ROWS,
    select: {
      kind: true,
      direction: true,
      subject: true,
      body: true,
      occurredAt: true,
      actorId: true,
      sourceKind: true,
      targets: { select: { targetKind: true, targetId: true } },
    },
  });
  const header = ["Date", "Type", "Direction", "Subject", "Body", "Record type", "Record", "Email", "By", "From"];
  const data: unknown[][] = [];
  for (const a of acts) {
    for (const t of a.targets) {
      const label =
        t.targetKind === "person"
          ? people.get(t.targetId)?.name
          : t.targetKind === "company"
            ? companies.get(t.targetId)?.name
            : deals.get(t.targetId)?.title;
      if (!label) continue;
      data.push([
        iso(a.occurredAt),
        a.kind,
        a.direction ?? "",
        a.subject ?? "",
        a.body ?? "",
        t.targetKind === "deal" ? "item" : t.targetKind,
        label,
        t.targetKind === "person" ? (people.get(t.targetId)?.primaryEmail ?? "") : "",
        a.actorId ? (names.get(a.actorId) ?? "") : "",
        a.sourceKind ?? "",
      ]);
    }
  }
  return { csv: toCsv(data, { header, bom: true }), rows: data.length, fileName: "crm-timeline.csv" };
}
