import { dealTypeField } from "@/lib/crm/deals-tab";
import { heatGrid, monthLabel } from "@/lib/crm/crm-reports";
import { formatMoney, formatMoneyShort } from "@/lib/crm/fields";
import { crmRecordHref } from "@/lib/crm/href";
import type { CrmListPayload, CrmSourceInfo, CrmStatPayload, CrmWidgetType } from "@/lib/reports/crm-widgets";
import { formatCrmValue } from "@/lib/reports/crm-widgets";
import type { WidgetPayload } from "@/lib/reports/compute";
import { dayBounds } from "@/lib/tasks/dates";
import type { TxClient } from "@/server/db/context";

import {
  dealsReport,
  onceInTx,
  outreachReport,
  peopleReport,
  type DealsReport,
  type ReportCtx,
} from "./crm-reports";
import { customFieldsFor } from "./databases";
import { rolePositions } from "./owners";
import { convertedList, issueGroups, talkedToStat, topIssuesPayload, type ClassicsCtx } from "./report-classics";

/**
 * The widgets of the CRM's ready-made reports in Databases > Reports
 * (src/lib/reports/crm-ready.ts): the classics (People talked to,
 * Converted, Top issues), Deals (Won, Still open, Won over time, By stage,
 * By owner, By type), People (New people by month, Going quiet, By
 * relationship, By owner) and Outreach (Sent, Replies by plan, Best day
 * and time, Unsubscribes). They read the same numbers the CRM's own report
 * pages did (crm-reports.ts), once per transaction, as the viewer.
 */

const DAY = 86_400_000;

export interface ReadyCtx {
  db: TxClient;
  organizationId: string;
  slug: string;
  tz: string;
  range: { from: string | null; to: string | null };
  crm: CrmSourceInfo;
  now: Date;
}

async function reportCtx(c: ReadyCtx): Promise<ReportCtx> {
  const names = await onceInTx(c.db, "crm:names", async () => {
    const m = await c.db.membership.findMany({
      where: { organizationId: c.organizationId },
      select: { userId: true, user: { select: { name: true } } },
      take: 2000,
    });
    return new Map(m.map((x) => [x.userId, x.user.name ?? "A member"]));
  });
  const roles = await onceInTx(c.db, "crm:roles", () => rolePositions(c.organizationId));
  return { db: c.db, organizationId: c.organizationId, slug: c.slug, tz: c.tz, range: c.range, now: c.now, roles, names };
}

const rangeKey = (c: ReadyCtx) => `${c.range.from ?? ""}:${c.range.to ?? ""}`;

function classicsCtx(c: ReadyCtx): ClassicsCtx {
  const start = c.range.from ? dayBounds(c.range.from, c.tz).start : new Date(0);
  const end = c.range.to ? dayBounds(c.range.to, c.tz).end : new Date(c.now.getTime() + DAY);
  const len = end.getTime() - start.getTime();
  return {
    db: c.db,
    organizationId: c.organizationId,
    slug: c.slug,
    start,
    end,
    previous: c.range.from ? { start: new Date(start.getTime() - len), end: start } : null,
    now: c.now,
  };
}

async function deals(c: ReadyCtx): Promise<DealsReport | null> {
  const pipelineId = c.crm.pipelineId;
  if (c.crm.kind !== "pipeline" || !pipelineId) return null;
  return onceInTx(c.db, `crm:deals:${pipelineId}:${rangeKey(c)}`, async () => {
    const pipeline = await c.db.crmPipeline.findFirst({
      where: { organizationId: c.organizationId, id: pipelineId },
      select: {
        id: true,
        name: true,
        hasAmount: true,
        currency: true,
        stages: { orderBy: { sortOrder: "asc" }, select: { id: true, name: true, kind: true, probability: true } },
      },
    });
    return pipeline ? dealsReport(await reportCtx(c), pipeline) : null;
  });
}

async function people(c: ReadyCtx) {
  return onceInTx(c.db, `crm:people:${rangeKey(c)}`, async () => {
    const settings = await c.db.crmSettings.findUnique({
      where: { organizationId: c.organizationId },
      select: { relationshipTypes: true },
    });
    const types = (Array.isArray(settings?.relationshipTypes) ? settings.relationshipTypes : []) as {
      id: string;
      label: string;
    }[];
    return peopleReport(await reportCtx(c), new Map(types.map((t) => [t.id, t.label])));
  });
}

async function outreach(c: ReadyCtx) {
  return onceInTx(c.db, `crm:outreach:${rangeKey(c)}`, async () => outreachReport(await reportCtx(c)));
}

const count = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** "$18,500" or "12 deals". */
function figure(r: DealsReport, cents: number, n: number): string {
  return r.pipeline.hasAmount ? formatMoney(cents, r.pipeline.currency) : count(n, "deal", "deals");
}

function noPipeline(): CrmListPayload {
  return { rows: [], caption: null, empty: "This pipeline isn't there any more." };
}

export async function readyWidgetPayload(c: ReadyCtx, type: CrmWidgetType): Promise<WidgetPayload | null> {
  switch (type) {
    // ---- The classics -------------------------------------------------------------
    case "crm-talked-to":
      return { type, data: await talkedToStat(classicsCtx(c)) };
    case "crm-converted":
      return { type, data: await convertedList(classicsCtx(c)) };
    case "crm-top-issues":
      return { type, data: topIssuesPayload(c.slug, await issueGroups(c), true) };

    // ---- Deals --------------------------------------------------------------------
    case "crm-won": {
      const r = await deals(c);
      if (!r) return null;
      const money = r.pipeline.hasAmount;
      const value = money ? r.won.cents : r.won.count;
      const previous = r.won.previousCents === null ? null : money ? r.won.previousCents : null;
      const goal = r.won.goal;
      const data: CrmStatPayload = {
        value,
        format: money ? "money" : "number",
        currency: r.pipeline.currency,
        previous,
        deltaPct: previous ? ((value - previous) / previous) * 100 : null,
        caption: money ? `In ${count(r.won.count, "deal", "deals")} that reached a won stage.` : "Deals that reached a won stage.",
        parts: goal
          ? [
              { label: "Goal", value: formatMoney(goal.target) },
              { label: "Of the goal", value: formatCrmValue(goal.share, "percent") },
              ...(r.likelyCents > 0 ? [{ label: "Likely before it ends", value: formatMoney(r.likelyCents) }] : []),
            ]
          : [],
        rows: [],
        empty: r.won.count === 0 ? `Nothing won in these dates yet${r.open.count ? `, with ${count(r.open.count, "deal", "deals")} still open` : ""}.` : null,
        line:
          r.won.count > 0
            ? {
                tone: goal && goal.share >= 1 ? "good" : "info",
                bold: figure(r, r.won.cents, r.won.count),
                text: goal
                  ? `${figure(r, r.won.cents, r.won.count)} won, ${Math.round(goal.share * 100)}% of the way to the ${formatMoney(goal.target)} goal.`
                  : `${figure(r, r.won.cents, r.won.count)} won in these dates.`,
              }
            : null,
      };
      return { type, data };
    }
    case "crm-open": {
      const r = await deals(c);
      if (!r) return null;
      const money = r.pipeline.hasAmount;
      const href = (id: string) => crmRecordHref(c.slug, "deal", id);
      const rows = [
        ...r.late.map((d) => ({ key: d.id, label: d.title, detail: "Past its next step", href: href(d.id) })),
        ...r.noStep.map((d) => ({ key: d.id, label: d.title, detail: "No next step", href: href(d.id) })),
      ];
      const data: CrmStatPayload = {
        value: money ? r.open.cents : r.open.count,
        format: money ? "money" : "number",
        currency: r.pipeline.currency,
        previous: null,
        deltaPct: null,
        caption: money ? `In ${count(r.open.count, "open deal", "open deals")}.` : "Deals not won or lost yet.",
        parts: [{ label: "With a dated next step", value: `${r.open.withStep} of ${r.open.count}` }],
        rows,
        empty: r.open.count === 0 ? "No open deals right now." : null,
        line:
          rows.length > 0
            ? {
                tone: "warn",
                bold: count(rows.length, "deal", "deals"),
                text: `${count(rows.length, "open deal needs", "open deals need")} a next step: ${rows
                  .slice(0, 2)
                  .map((x) => x.label)
                  .join(" and ")}${rows.length > 2 ? " and more" : ""}.`,
                next: "Give each open deal a next step with a date.",
              }
            : null,
      };
      return { type, data };
    }
    case "crm-won-months": {
      const r = await deals(c);
      if (!r) return { type, data: noPipeline() };
      const money = r.pipeline.hasAmount;
      return {
        type,
        data: {
          shape: "columns",
          rows: r.months.map((m) => ({
            key: m.key,
            label: monthLabel(m.key),
            value: m.cents,
            display: m.cents ? formatMoneyShort(m.cents, r.pipeline.currency) : "0",
          })),
          caption: money ? null : "Add amounts to this pipeline to see what was won each month.",
          empty: "Nothing won yet.",
        },
      };
    }
    case "crm-deals-by-stage": {
      const r = await deals(c);
      if (!r) return { type, data: noPipeline() };
      const money = r.pipeline.hasAmount;
      return {
        type,
        data: {
          rows: r.byStage.map((s) => ({
            key: s.id,
            label: s.name,
            value: money ? s.cents : s.count,
            display: figure(r, s.cents, s.count),
            detail: money ? count(s.count, "deal", "deals") : null,
          })),
          caption: "Every open deal, and the ones closed in these dates.",
          empty: "No deals yet.",
        },
      };
    }
    case "crm-deals-by-owner": {
      const r = await deals(c);
      if (!r) return { type, data: noPipeline() };
      const money = r.pipeline.hasAmount;
      return {
        type,
        data: {
          rows: r.byOwner.map((o) => ({
            key: o.name,
            label: o.name,
            value: money ? o.cents : o.count,
            display: figure(r, o.cents, o.count),
          })),
          caption: "Won in these dates.",
          empty: "Nothing won in these dates yet.",
        },
      };
    }
    case "crm-deals-by-type": {
      const r = await deals(c);
      if (!r) return { type, data: noPipeline() };
      const money = r.pipeline.hasAmount;
      const untyped = r.byType.length === 1 && r.byType[0]!.label === "No type";
      const hasField = Boolean(
        dealTypeField(await customFieldsFor(c.db, c.organizationId, "deal", r.pipeline.id)),
      );
      return {
        type,
        data: {
          rows: r.byType.map((t) => ({
            key: t.label,
            label: t.label,
            value: money ? t.cents : t.count,
            display: figure(r, t.cents, t.count),
          })),
          caption: untyped
            ? hasField
              ? "Pick a type on a deal's Details to see them split here."
              : "Add a Type field to this pipeline in CRM settings to split deals by it."
            : "Open and won deals.",
          empty: "No deals yet.",
        },
      };
    }

    // ---- People -------------------------------------------------------------------
    case "crm-people-months": {
      const r = await people(c);
      return {
        type,
        data: {
          shape: "columns",
          rows: r.months.map((m) => ({ key: m.key, label: monthLabel(m.key), value: m.count, display: String(m.count) })),
          caption: `${count(r.addedInRange, "person", "people")} added in these dates.`,
          empty: "Nobody added yet.",
        },
      };
    }
    case "crm-quiet": {
      const r = await people(c);
      return {
        type,
        data: {
          value: r.quiet.count,
          format: "number",
          previous: null,
          deltaPct: null,
          caption: "People with no touch in 60 days or more.",
          parts: [],
          rows: r.quiet.people.map((p) => ({
            key: p.id,
            label: p.name,
            detail: [`${p.days} days`, p.relationship?.toLowerCase()].filter(Boolean).join(", "),
            href: crmRecordHref(c.slug, "person", p.id),
          })),
          empty: r.quiet.count === 0 ? "Nobody has gone quiet." : null,
          queue: r.quiet.ids,
          line:
            r.quiet.count > 0
              ? {
                  tone: "warn",
                  bold: String(r.quiet.count),
                  text: `${count(r.quiet.count, "person has", "people have")} gone 60 days or more without a touch.`,
                  next: "Add the people going quiet to tomorrow's Power hour.",
                }
              : null,
        },
      };
    }
    case "crm-people-by-relationship": {
      const r = await people(c);
      return {
        type,
        data: {
          rows: r.byRelationship.slice(0, 8).map((x) => ({
            key: x.label,
            label: x.label,
            value: x.count,
            display: x.count.toLocaleString("en-US"),
          })),
          caption: `${count(r.total, "person", "people")} in People.`,
          empty: "Nobody in People yet.",
        },
      };
    }
    case "crm-people-by-owner": {
      const r = await people(c);
      return {
        type,
        data: {
          rows: r.byOwner.slice(0, 8).map((o) => ({
            key: o.name,
            label: o.name,
            value: o.count,
            display: o.count.toLocaleString("en-US"),
          })),
          caption: null,
          empty: "Nobody in People yet.",
        },
      };
    }

    // ---- Outreach -----------------------------------------------------------------
    case "crm-sent": {
      const r = await outreach(c);
      const s = r.sent;
      return {
        type,
        data: {
          value: s.total,
          format: "number",
          previous: s.previous,
          deltaPct: s.previous ? ((s.total - s.previous) / s.previous) * 100 : null,
          caption: "Emails and texts from every plan.",
          parts: [
            { label: "Emails", value: s.emails.toLocaleString("en-US") },
            { label: "Texts", value: s.texts.toLocaleString("en-US") },
            { label: "Bounced", value: s.bounced.toLocaleString("en-US") },
            ...(r.emailRate !== null ? [{ label: "Emails answered", value: formatCrmValue(r.emailRate, "percent") }] : []),
          ],
          rows: [],
          empty: s.total === 0 ? "Nothing sent in these dates yet." : null,
          line: s.bounced
            ? {
                tone: "warn",
                bold: String(s.bounced),
                text: `${count(s.bounced, "email", "emails")} bounced. Check those addresses.`,
              }
            : null,
        },
      };
    }
    case "crm-replies-by-plan": {
      const r = await outreach(c);
      return {
        type,
        data: {
          rows: r.byPlan.map((p) => ({
            key: p.name,
            label: p.name,
            value: p.replied,
            display: `${p.replied} ${p.replied === 1 ? "reply" : "replies"}`,
            detail: `${p.sent} sent`,
          })),
          caption: null,
          empty: "No sequence or campaign has sent anything in these dates yet.",
        },
      };
    }
    case "crm-best-time": {
      const r = await outreach(c);
      const grid = heatGrid(r.cells);
      const words = (day: string) =>
        ({ Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday" })[day] ?? day;
      return {
        type,
        data: {
          ...grid,
          caption: grid.best
            ? `${words(grid.best.day)} ${grid.best.part.toLowerCase()}: ${formatCrmValue(grid.best.rate, "percent")} reply.`
            : "Too few emails yet to say when works best.",
          empty: null,
          line: grid.best
            ? {
                tone: "info",
                bold: `${words(grid.best.day)} ${grid.best.part.toLowerCase()}`,
                text: `Emails sent ${words(grid.best.day)} ${grid.best.part.toLowerCase()} get the most replies (${formatCrmValue(grid.best.rate, "percent")}).`,
              }
            : null,
        },
      };
    }
    case "crm-unsubscribes": {
      const r = await outreach(c);
      const u = r.unsubscribes;
      const top = u.byPlan[0];
      return {
        type,
        data: {
          value: u.count,
          format: "number",
          previous: null,
          deltaPct: null,
          caption: r.sent.emails
            ? `${((u.count / r.sent.emails) * 100).toFixed(1)}% of the emails sent.`
            : "People who asked not to be emailed.",
          parts: [],
          rows: u.byPlan.slice(0, 4).map((p) => ({ key: p.name, label: p.name, detail: String(p.count), href: null })),
          empty: u.count === 0 ? "Nobody unsubscribed in these dates." : null,
          line:
            top && u.count > 1
              ? {
                  tone: "warn",
                  bold: `${top.count} of the ${u.count}`,
                  text: `${top.count} of the ${u.count} unsubscribes came after ${top.name}.`,
                }
              : null,
        },
      };
    }
    default:
      return null;
  }
}

