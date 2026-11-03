import "server-only";

import { z } from "zod";

import { NotFoundError } from "@/lib/auth/errors";
import type { TargetKind, TargetRef } from "@/lib/crm/suggestions";
import { CrmError, requireCrm } from "@/server/crm/access";
import { timeline } from "@/server/crm/activity";
import { changesSince, notContacted, searchCrm, type Hit } from "@/server/crm/lookups";
import type { OrgContext } from "@/server/db/context";
import { AppError } from "@/server/db/errors";

import { itemId, refOf, type ItemKind, type ItemRef } from "./ids";
import {
  dayArg,
  itemArg,
  limitArg,
  READ_ONLY,
  readResult,
  spaceArg,
  spaceRef,
  urlField,
  type ConnectorSession,
  type FetchedItem,
  type ToolRegistrar,
} from "./shared";
import { inSpace, type ToolSpace } from "./space";
import { zonedIso } from "./text";

/**
 * The CRM's read tools (docs/features/crm.md module 10, "Your own Claude"):
 * search people, companies and pipeline items; read a record's timeline;
 * who nobody has talked to in N days; what changed with a record since a
 * day; the pipelines and their stages. Each runs as the member under RLS
 * (a CRM on "members see their own" shows them only theirs), in a space
 * that has the CRM added and on its plan. Text members and contacts wrote
 * comes back as data fields.
 */

export const CRM = { feature: "crm", section: "crm" } as const;

/** The CRM isn't added, or isn't on the plan: in its own words. */
export class CrmToolError extends AppError {
  constructor(message: string) {
    super(message, 403, "CONNECTOR_CRM");
    this.name = "CrmToolError";
  }
}

/** Runs `fn` in the space's CRM as the member (read tools). */
export function inCrm<T>(session: ConnectorSession, spaceId: string, fn: (ctx: OrgContext, space: ToolSpace) => Promise<T>): Promise<T> {
  return inSpace(session, spaceId, CRM, async (ctx, space) => {
    try {
      await requireCrm(ctx);
    } catch (error) {
      if (error instanceof CrmError) throw new CrmToolError(error.message);
      throw error;
    }
    return fn(ctx, space);
  });
}

export const KIND_OF: Record<TargetKind, ItemKind> = { person: "crmperson", company: "crmcompany", deal: "crmitem" };
const TARGET_OF: Partial<Record<ItemKind, TargetKind>> = { crmperson: "person", crmcompany: "company", crmitem: "deal" };
const WORD: Record<TargetKind, "person" | "company" | "item"> = { person: "person", company: "company", deal: "item" };
const PATH: Record<TargetKind, string> = { person: "people", company: "companies", deal: "items" };

/** A CRM record's opaque id, and back. */
export function crmItemId(space: ToolSpace, target: TargetRef): string {
  return itemId(KIND_OF[target.kind], space.id, target.id);
}

export function crmRef(value: string): { ref: ItemRef; target: TargetRef } {
  const ref = refOf(value, "crmperson", "crmcompany", "crmitem");
  return { ref, target: { kind: TARGET_OF[ref.kind]!, id: ref.id } };
}

export function recordUrl(space: ToolSpace, target: TargetRef): string {
  return space.url(`/crm/${PATH[target.kind]}/${target.id}`);
}

function instant(d: Date | null | undefined, zone: string): string | null {
  return d ? zonedIso(d, zone) : null;
}

const recordOut = z.object({
  id: z.string().describe("The record's id, for the other CRM tools and fetch."),
  kind: z.enum(["person", "company", "item"]),
  name: z.string(),
  detail: z.string().nullable().describe("A person's title and company, a company's industry, an item's pipeline and stage."),
  lastContacted: z.string().nullable().describe("When anyone in the organization was last in touch (ISO 8601), or null for never."),
  url: urlField,
});
type RecordOut = z.infer<typeof recordOut>;

function hitOut(space: ToolSpace, h: Hit): RecordOut {
  const target = { kind: h.kind, id: h.id };
  return {
    id: crmItemId(space, target),
    kind: WORD[h.kind],
    name: h.name,
    detail: h.sub,
    lastContacted: instant(h.lastContactedAt, space.zone),
    url: recordUrl(space, target),
  };
}

// ---------------------------------------------------------------- crm_search

const searchInput = z.object({
  space: spaceArg,
  query: z.string().max(100).describe("Words in a name, title, company, domain or email. Empty lists the most recently contacted."),
  kinds: z
    .array(z.enum(["people", "companies", "items"]))
    .max(3)
    .optional()
    .describe("What to search; all three unless given."),
  limit: limitArg,
});
const searchOutput = z.object({ space: spaceRef, results: z.array(recordOut) });

const KIND_IN: Record<"people" | "companies" | "items", TargetKind> = { people: "person", companies: "company", items: "deal" };

export async function crmSearchTool(session: ConnectorSession, raw: z.input<typeof searchInput>) {
  const args = searchInput.parse(raw);
  return inCrm(session, args.space, async (ctx, space) => {
    const kinds = (args.kinds?.length ? args.kinds : (["people", "companies", "items"] as const)).map((k) => KIND_IN[k]);
    const hits = await searchCrm(ctx.db, space.id, args.query, kinds, args.limit);
    return { space: { id: space.id, name: space.name }, results: hits.slice(0, args.limit).map((h) => hitOut(space, h)) };
  });
}

// ---------------------------------------------------------------- crm_timeline

const entryOut = z.object({
  when: z.string().describe("ISO 8601, in the member's zone."),
  kind: z.string().describe("email, meeting, call, text, note, task, form_response, rsvp, check_in, payment, stage_change, field_change..."),
  direction: z.enum(["inbound", "outbound"]).nullable(),
  subject: z.string().nullable(),
  text: z.string().nullable().describe("What was written, as members and contacts wrote it (first 2,000 characters)."),
  by: z.string().nullable().describe("The member it was with or by."),
});

const timelineInput = z.object({
  id: itemArg("CRM record"),
  before: z.string().max(40).optional().describe("Only entries before this ISO 8601 time (the last entry's `when`, for older ones)."),
  limit: limitArg,
});
const timelineOutput = z.object({ space: spaceRef, record: recordOut, entries: z.array(entryOut) });

async function recordHit(ctx: OrgContext, space: ToolSpace, target: TargetRef): Promise<Hit> {
  if (target.kind === "person") {
    const p = await ctx.db.crmPerson.findFirst({
      where: { id: target.id, organizationId: space.id, deletedAt: null },
      select: { id: true, name: true, title: true, lastContactedAt: true, company: { select: { name: true } } },
    });
    if (!p) throw new NotFoundError();
    return { kind: "person", id: p.id, name: p.name, sub: [p.title, p.company?.name].filter(Boolean).join(" at ") || null, lastContactedAt: p.lastContactedAt };
  }
  if (target.kind === "company") {
    const c = await ctx.db.crmCompany.findFirst({
      where: { id: target.id, organizationId: space.id, deletedAt: null },
      select: { id: true, name: true, industry: true, lastContactedAt: true },
    });
    if (!c) throw new NotFoundError();
    return { kind: "company", id: c.id, name: c.name, sub: c.industry, lastContactedAt: c.lastContactedAt };
  }
  const d = await ctx.db.crmDeal.findFirst({
    where: { id: target.id, organizationId: space.id, deletedAt: null },
    select: { id: true, title: true, pipeline: { select: { name: true } }, stage: { select: { name: true } } },
  });
  if (!d) throw new NotFoundError();
  return { kind: "deal", id: d.id, name: d.title, sub: `${d.pipeline.name}, ${d.stage.name}`, lastContactedAt: null };
}

async function memberNames(ctx: OrgContext, spaceId: string): Promise<Map<string, string>> {
  const rows = await ctx.db.membership.findMany({ where: { organizationId: spaceId }, select: { userId: true, user: { select: { name: true } } } });
  return new Map(rows.map((r) => [r.userId, r.user.name ?? "Member"]));
}

export async function crmTimelineTool(session: ConnectorSession, raw: z.input<typeof timelineInput>) {
  const args = timelineInput.parse(raw);
  const { ref, target } = crmRef(args.id);
  return inCrm(session, ref.spaceId, async (ctx, space) => {
    const hit = await recordHit(ctx, space, target);
    const before = args.before ? new Date(args.before) : undefined;
    const entries = await timeline(ctx.db, space.id, target, { take: args.limit, before: before && !Number.isNaN(before.getTime()) ? before : undefined });
    const names = await memberNames(ctx, space.id);
    return {
      space: { id: space.id, name: space.name },
      record: hitOut(space, hit),
      entries: entries.map((e) => ({
        when: instant(e.occurredAt, space.zone)!,
        kind: e.kind.toLowerCase(),
        direction: e.direction ? (e.direction === "INBOUND" ? ("inbound" as const) : ("outbound" as const)) : null,
        subject: e.subject,
        text: e.body ? e.body.slice(0, 2000) : null,
        by: e.actorId ? (names.get(e.actorId) ?? "A former member") : null,
      })),
    };
  });
}

// ---------------------------------------------------------------- crm_not_contacted

const coldInput = z.object({
  space: spaceArg,
  days: z.number().int().min(1).max(3650).describe("Nobody in the organization has been in touch for at least this many days."),
  kind: z.enum(["people", "companies"]).default("people").describe('"people" unless given.'),
  mine: z.boolean().default(false).describe("Only the ones the member owns."),
  includeNever: z.boolean().default(false).describe("Also those never contacted at all (added before the cut-off)."),
  limit: limitArg,
});
const coldOutput = z.object({ space: spaceRef, results: z.array(recordOut) });

export async function crmNotContactedTool(session: ConnectorSession, raw: z.input<typeof coldInput>) {
  const args = coldInput.parse(raw);
  return inCrm(session, args.space, async (ctx, space) => {
    const hits = await notContacted(ctx.db, space.id, {
      days: args.days,
      kind: args.kind === "companies" ? "company" : "person",
      ownerId: args.mine ? ctx.userId : null,
      includeNever: args.includeNever,
      take: args.limit,
    });
    return { space: { id: space.id, name: space.name }, results: hits.map((h) => hitOut(space, h)) };
  });
}

// ---------------------------------------------------------------- crm_changes_since

const changesInput = z.object({
  id: itemArg("CRM record"),
  since: dayArg.describe("The first day to include (yyyy-mm-dd)."),
});
const changesOutput = z.object({
  space: spaceRef,
  record: recordOut,
  fieldChanges: z.array(
    z.object({
      when: z.string(),
      field: z.string().describe('A field key ("title", "stageId", "custom.<id>").'),
      from: z.unknown(),
      to: z.unknown(),
      by: z.string().nullable(),
      source: z.string().describe("user, ai, connector, automation, import, merge, system or finance."),
    }),
  ),
  entries: z.array(entryOut),
});

export async function crmChangesTool(session: ConnectorSession, raw: z.input<typeof changesInput>) {
  const args = changesInput.parse(raw);
  const { ref, target } = crmRef(args.id);
  return inCrm(session, ref.spaceId, async (ctx, space) => {
    const hit = await recordHit(ctx, space, target);
    const ch = await changesSince(ctx.db, space.id, target, new Date(`${args.since}T00:00:00Z`));
    const names = await memberNames(ctx, space.id);
    return {
      space: { id: space.id, name: space.name },
      record: hitOut(space, hit),
      fieldChanges: ch.history.map((h) => ({
        when: instant(h.changedAt, space.zone)!,
        field: h.field,
        from: h.oldValue ?? null,
        to: h.newValue ?? null,
        by: h.changedById ? (names.get(h.changedById) ?? "A former member") : null,
        source: h.source,
      })),
      entries: ch.timeline.map((e) => ({
        when: instant(e.occurredAt, space.zone)!,
        kind: e.kind.toLowerCase(),
        direction: e.direction ? (e.direction === "INBOUND" ? ("inbound" as const) : ("outbound" as const)) : null,
        subject: e.subject,
        text: e.body ? e.body.slice(0, 2000) : null,
        by: e.actorId ? (names.get(e.actorId) ?? "A former member") : null,
      })),
    };
  });
}

// ---------------------------------------------------------------- crm_pipelines

const pipelinesInput = z.object({ space: spaceArg });
const pipelinesOutput = z.object({
  space: spaceRef,
  pipelines: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      itemNoun: z.string().describe('What one item is called ("sponsorship", "applicant").'),
      stages: z.array(z.object({ id: z.string().describe("For crm_move_stage."), name: z.string(), kind: z.enum(["open", "won", "lost"]), items: z.number().int() })),
      url: urlField,
    }),
  ),
});

export async function crmPipelinesTool(session: ConnectorSession, raw: z.input<typeof pipelinesInput>) {
  const args = pipelinesInput.parse(raw);
  return inCrm(session, args.space, async (ctx, space) => {
    const pipelines = await ctx.db.crmPipeline.findMany({
      where: { organizationId: space.id, archivedAt: null },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, itemNoun: true, stages: { orderBy: { sortOrder: "asc" }, select: { id: true, name: true, kind: true } } },
    });
    const counts = await ctx.db.crmDeal.groupBy({ by: ["stageId"], where: { organizationId: space.id, deletedAt: null }, _count: { _all: true } });
    return {
      space: { id: space.id, name: space.name },
      pipelines: pipelines.map((p) => ({
        id: p.id,
        name: p.name,
        itemNoun: p.itemNoun,
        stages: p.stages.map((s) => ({
          id: s.id,
          name: s.name,
          kind: s.kind.toLowerCase() as "open" | "won" | "lost",
          items: counts.find((c) => c.stageId === s.id)?._count._all ?? 0,
        })),
        url: space.url(`/crm/pipelines/${p.id}`),
      })),
    };
  });
}

// ---------------------------------------------------------------- fetch

/** A CRM record for fetch: its facts and its latest timeline as text. */
export async function fetchCrmRecord(session: ConnectorSession, ref: ItemRef): Promise<FetchedItem> {
  const target: TargetRef = { kind: TARGET_OF[ref.kind]!, id: ref.id };
  return inCrm(session, ref.spaceId, async (ctx, space) => {
    const hit = await recordHit(ctx, space, target);
    const entries = await timeline(ctx.db, space.id, target, { take: 15 });
    const text = [
      `# ${hit.name}`,
      hit.sub,
      hit.lastContactedAt ? `Last contacted ${instant(hit.lastContactedAt, space.zone)}` : "Never contacted",
      entries.length
        ? `## Latest on the timeline\n${entries.map((e) => `- ${instant(e.occurredAt, space.zone)} ${e.kind.toLowerCase()}: ${e.subject ?? ""}${e.body ? ` ${e.body.slice(0, 300)}` : ""}`).join("\n")}`
        : "Nothing on the timeline yet.",
    ]
      .filter(Boolean)
      .join("\n\n");
    return {
      id: crmItemId(space, target),
      title: hit.name,
      text,
      url: recordUrl(space, target),
      metadata: { kind: WORD[target.kind], spaceId: space.id, space: space.name },
    };
  });
}

// ---------------------------------------------------------------- registration

export const registerCrmTools: ToolRegistrar = (server, session) => {
  server.registerTool(
    "crm_search",
    {
      title: "Search the CRM",
      description: "Finds people, companies and pipeline items in one space's CRM by words in their name, title, company, domain or email.",
      inputSchema: searchInput,
      outputSchema: searchOutput,
      annotations: READ_ONLY,
    },
    (args) => readResult("crm_search", () => crmSearchTool(session, args)),
  );
  server.registerTool(
    "crm_timeline",
    {
      title: "Read a CRM timeline",
      description: "Reads one person's, company's or item's timeline, newest first: emails, meetings, calls, texts, notes, form answers, RSVPs, check-ins, payments and stage moves.",
      inputSchema: timelineInput,
      outputSchema: timelineOutput,
      annotations: READ_ONLY,
    },
    (args) => readResult("crm_timeline", () => crmTimelineTool(session, args)),
  );
  server.registerTool(
    "crm_not_contacted",
    {
      title: "Who we haven't talked to",
      description: "Lists the people (or companies) nobody in the organization has been in touch with for at least N days, longest first.",
      inputSchema: coldInput,
      outputSchema: coldOutput,
      annotations: READ_ONLY,
    },
    (args) => readResult("crm_not_contacted", () => crmNotContactedTool(session, args)),
  );
  server.registerTool(
    "crm_changes_since",
    {
      title: "What changed since",
      description: "Lists what changed with one CRM record since a day: its field changes (who, from, to) and its new timeline entries.",
      inputSchema: changesInput,
      outputSchema: changesOutput,
      annotations: READ_ONLY,
    },
    (args) => readResult("crm_changes_since", () => crmChangesTool(session, args)),
  );
  server.registerTool(
    "crm_pipelines",
    {
      title: "List CRM pipelines",
      description: "Lists one space's CRM pipelines with their stages and how many items are in each.",
      inputSchema: pipelinesInput,
      outputSchema: pipelinesOutput,
      annotations: READ_ONLY,
    },
    (args) => readResult("crm_pipelines", () => crmPipelinesTool(session, args)),
  );
};
