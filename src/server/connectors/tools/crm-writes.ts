import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { z } from "zod";

import { NotFoundError } from "@/lib/auth/errors";
import { normalizeEmail } from "@/lib/crm/dedupe";
import { emailTells, withEmailStyle } from "@/lib/crm/email-style";
import { connectorAppliesDirectly, type Citation, type TargetRef } from "@/lib/crm/suggestions";
import { CrmError, requireCrm } from "@/server/crm/access";
import { logActivity } from "@/server/crm/activity";
import { deliverDraft } from "@/server/crm/drafts";
import { changeLabel, proposeChange } from "@/server/crm/review";
import type { OrgContext } from "@/server/db/context";

import { CRM, CrmToolError, crmItemId, crmRef, recordUrl } from "./crm";
import { itemArg, readResult, spaceArg, spaceRef, urlField, type ConnectorSession, type ToolRegistrar } from "./shared";
import type { ToolSpace } from "./space";
import { ADDS, writeInSpace, type Written } from "./write";

/**
 * The CRM's write tools for a member's own connected app (docs/features/
 * crm.md, module 10). They never delete and never send. What they do:
 *
 *   crm_log_activity, crm_add_note   applied at once on a WRITE grant: low
 *                                     risk, and on the timeline as from the
 *                                     connected app
 *   crm_create_person, crm_create_company, crm_update_record,
 *   crm_move_stage                    queued in the Review tab as a before
 *                                     and after, for the member (or anyone)
 *                                     to accept: field changes and stage
 *                                     moves always wait for a person
 *   crm_draft_email                   a draft in the Review tab, never sent
 *   crm_build_list                    a saved list (a personal view)
 *
 * Every one goes through writeInSpace: WRITE grants only, 120 writes an
 * hour per grant, the space's CRM, the audit row.
 */

const queuedOutput = z.object({
  space: spaceRef,
  status: z.enum(["queued", "applied"]).describe("queued: it waits in the CRM's Review tab for a person to accept; applied: it's done."),
  suggestionId: z.string().nullable(),
  record: z.object({ id: z.string(), name: z.string(), url: urlField }).nullable(),
  reviewUrl: urlField.describe("Where the member accepts or rejects it."),
  message: z.string(),
});
type QueuedOutput = z.infer<typeof queuedOutput>;

function connectorCitation(session: ConnectorSession, what: string): Citation {
  return { kind: "connector", label: `${session.grant.clientName ?? "A connected app"}: ${what}`.slice(0, 200) };
}

async function crmGate(ctx: OrgContext): Promise<void> {
  try {
    await requireCrm(ctx);
  } catch (error) {
    if (error instanceof CrmError) throw new CrmToolError(error.message);
    throw error;
  }
}

/** Runs a CRM write: the core's refusals come back in its words and roll the write back. */
function crmWrite<T>(
  session: ConnectorSession,
  tool: string,
  spaceId: string,
  fn: (ctx: OrgContext, space: ToolSpace) => Promise<Written<T>>,
): Promise<T> {
  return writeInSpace(session, tool, spaceId, CRM, async (ctx, space) => {
    await crmGate(ctx);
    try {
      return await fn(ctx, space);
    } catch (error) {
      if (error instanceof CrmError) throw new CrmToolError(error.message);
      throw error;
    }
  });
}

async function nameOf(ctx: OrgContext, spaceId: string, target: TargetRef): Promise<string> {
  const row =
    target.kind === "person"
      ? await ctx.db.crmPerson.findFirst({ where: { id: target.id, organizationId: spaceId, deletedAt: null }, select: { name: true } })
      : target.kind === "company"
        ? await ctx.db.crmCompany.findFirst({ where: { id: target.id, organizationId: spaceId, deletedAt: null }, select: { name: true } })
        : await ctx.db.crmDeal.findFirst({ where: { id: target.id, organizationId: spaceId, deletedAt: null }, select: { title: true } });
  if (!row) throw new NotFoundError();
  return "name" in row ? row.name : row.title;
}

function queued(space: ToolSpace, id: string, record: QueuedOutput["record"], message: string): QueuedOutput {
  return {
    space: { id: space.id, name: space.name },
    status: "queued",
    suggestionId: id,
    record,
    reviewUrl: space.url("/crm/queue"),
    message,
  };
}

// ---------------------------------------------------------------- create

const text = (max: number) => z.string().trim().max(max);

const personInput = z.object({
  space: spaceArg,
  name: text(200).min(1).describe("Their full name."),
  email: text(254).optional(),
  phone: text(60).optional(),
  title: text(200).optional(),
  company: text(200).optional().describe("Their company's name (matched to one in the CRM, or made with them)."),
  linkedin: text(500).optional(),
  location: text(200).optional(),
  note: text(5000).optional().describe("How the member knows them, logged on their timeline once they're added."),
});

export async function crmCreatePersonTool(session: ConnectorSession, raw: z.input<typeof personInput>) {
  const args = personInput.parse(raw);
  return crmWrite(session, "crm_create_person", args.space, async (ctx, space) => {
    const { id } = await proposeChange(ctx.db, {
      organizationId: space.id,
      kind: "CREATE_PERSON",
      source: "CONNECTOR",
      title: `Add ${args.name}`,
      payload: {
        person: {
          name: args.name,
          primaryEmail: args.email ? normalizeEmail(args.email) : null,
          phone: args.phone ?? null,
          title: args.title ?? null,
          companyName: args.company ?? null,
          linkedinUrl: args.linkedin ?? null,
          location: args.location ?? null,
        },
        activity: args.note ? { kind: "NOTE", subject: "How we know them", body: args.note } : null,
      },
      citation: connectorCitation(session, "asked to add this person"),
      proposedById: ctx.userId,
      assigneeId: ctx.userId,
    });
    return {
      output: queued(space, id, null, `${args.name} waits in the CRM's Review tab; they're added when the member accepts.`),
      target: { type: "CrmSuggestion", id },
    };
  });
}

const companyInput = z.object({
  space: spaceArg,
  name: text(200).min(1),
  domain: text(200).optional().describe("Their email domain (example.org)."),
  website: text(500).optional(),
  industry: text(200).optional(),
  size: text(60).optional(),
  about: text(2000).optional(),
});

export async function crmCreateCompanyTool(session: ConnectorSession, raw: z.input<typeof companyInput>) {
  const args = companyInput.parse(raw);
  return crmWrite(session, "crm_create_company", args.space, async (ctx, space) => {
    const { id } = await proposeChange(ctx.db, {
      organizationId: space.id,
      kind: "CREATE_COMPANY",
      source: "CONNECTOR",
      title: `Add ${args.name}`,
      payload: {
        company: {
          name: args.name,
          domain: args.domain ?? null,
          website: args.website ?? null,
          industry: args.industry ?? null,
          size: args.size ?? null,
          description: args.about ?? null,
        },
      },
      citation: connectorCitation(session, "asked to add this company"),
      proposedById: ctx.userId,
      assigneeId: ctx.userId,
    });
    return {
      output: queued(space, id, null, `${args.name} waits in the CRM's Review tab; it's added when the member accepts.`),
      target: { type: "CrmSuggestion", id },
    };
  });
}

// ---------------------------------------------------------------- update and move

const FIELDS = {
  person: ["title", "phone", "primaryEmail", "companyName", "linkedinUrl", "website", "location", "nextFollowUpAt", "status"],
  company: ["name", "domain", "website", "industry", "size", "phone", "address", "description", "nextFollowUpAt", "status"],
  deal: ["title", "amount", "expectedOn", "nextStep", "nextStepAt", "closeReason"],
} as const;

const updateInput = z.object({
  id: itemArg("CRM record"),
  changes: z
    .record(z.string().max(40), z.union([z.string().max(2000), z.number(), z.null()]))
    .describe(
      "Field keys and their new values (null clears one). People: title, phone, primaryEmail, companyName, linkedinUrl, website, location, nextFollowUpAt (yyyy-mm-dd), status (ACTIVE, INACTIVE, ALUMNI). Companies: name, domain, website, industry, size, phone, address, description, nextFollowUpAt, status. Items: title, amount (dollars), expectedOn, nextStep, nextStepAt, closeReason.",
    ),
  why: text(500).optional().describe("Why, in a line, for the member reviewing it."),
});

export async function crmUpdateRecordTool(session: ConnectorSession, raw: z.input<typeof updateInput>) {
  const args = updateInput.parse(raw);
  const { ref, target } = crmRef(args.id);
  return crmWrite(session, "crm_update_record", ref.spaceId, async (ctx, space) => {
    const allowed = FIELDS[target.kind] as readonly string[];
    const keys = Object.keys(args.changes);
    const unknown = keys.filter((k) => !allowed.includes(k));
    if (keys.length === 0) throw new CrmToolError("Name at least one field to change.");
    if (unknown.length) throw new CrmToolError(`These can't be changed here: ${unknown.slice(0, 5).join(", ")}. The tool's description lists the fields.`);
    const name = await nameOf(ctx, space.id, target);
    const { id } = await proposeChange(ctx.db, {
      organizationId: space.id,
      kind: "UPDATE_FIELD",
      source: "CONNECTOR",
      title: `Update ${name}`,
      summary: args.why ?? null,
      payload: { changes: keys.map((k) => ({ field: k, label: changeLabel(target.kind, k), after: args.changes[k] })) },
      target,
      citation: connectorCitation(session, args.why ?? "asked to change these fields"),
      proposedById: ctx.userId,
      assigneeId: ctx.userId,
    });
    return {
      output: queued(space, id, { id: crmItemId(space, target), name, url: recordUrl(space, target) }, "The change waits in the CRM's Review tab: field changes always need a person to accept them."),
      target: { type: "CrmSuggestion", id },
    };
  });
}

const moveInput = z.object({
  id: itemArg("pipeline item"),
  stage: text(200).min(1).describe("The stage's id from crm_pipelines, or its exact name."),
  reason: text(2000).optional().describe("Why, for a closing stage (won or lost)."),
});

export async function crmMoveStageTool(session: ConnectorSession, raw: z.input<typeof moveInput>) {
  const args = moveInput.parse(raw);
  const { ref, target } = crmRef(args.id);
  if (target.kind !== "deal") throw new NotFoundError();
  return crmWrite(session, "crm_move_stage", ref.spaceId, async (ctx, space) => {
    const deal = await ctx.db.crmDeal.findFirst({
      where: { id: target.id, organizationId: space.id, deletedAt: null },
      select: { title: true, pipelineId: true, stage: { select: { id: true, name: true } } },
    });
    if (!deal) throw new NotFoundError();
    const stages = await ctx.db.crmStage.findMany({ where: { organizationId: space.id, pipelineId: deal.pipelineId }, select: { id: true, name: true } });
    const stage = stages.find((s) => s.id === args.stage) ?? stages.find((s) => s.name.toLowerCase() === args.stage.toLowerCase());
    if (!stage) throw new CrmToolError(`That pipeline has no stage "${args.stage.slice(0, 60)}". crm_pipelines lists its stages.`);
    if (stage.id === deal.stage.id) throw new CrmToolError(`It's already in ${stage.name}.`);
    const { id } = await proposeChange(ctx.db, {
      organizationId: space.id,
      kind: "MOVE_STAGE",
      source: "CONNECTOR",
      title: `Move ${deal.title} to ${stage.name}`,
      summary: args.reason ?? null,
      payload: { stageId: stage.id, stageName: stage.name, fromStageName: deal.stage.name, closeReason: args.reason ?? null },
      target,
      citation: connectorCitation(session, "asked to move this item"),
      proposedById: ctx.userId,
      assigneeId: ctx.userId,
    });
    return {
      output: queued(space, id, { id: crmItemId(space, target), name: deal.title, url: recordUrl(space, target) }, "The move waits in the CRM's Review tab: stage moves always need a person to accept them."),
      target: { type: "CrmSuggestion", id },
    };
  });
}

// ---------------------------------------------------------------- the timeline

const KINDS = { note: "NOTE", call: "CALL", meeting: "MEETING", email: "EMAIL", text: "TEXT" } as const;

const logInput = z.object({
  id: itemArg("CRM record"),
  kind: z.enum(["note", "call", "meeting", "email", "text"]),
  subject: text(300).optional(),
  text: text(20_000).min(1).describe("What happened, or the message, as the member would log it."),
  when: z.string().max(40).optional().describe("When it happened (ISO 8601); now unless given."),
  direction: z.enum(["inbound", "outbound"]).optional().describe("For emails, calls and texts: from them (inbound) or from us (outbound)."),
});

export async function logToTimeline(
  session: ConnectorSession,
  tool: string,
  args: { id: string; kind: keyof typeof KINDS; subject?: string; text: string; when?: string; direction?: "inbound" | "outbound" },
): Promise<QueuedOutput> {
  const { ref, target } = crmRef(args.id);
  return crmWrite(session, tool, ref.spaceId, async (ctx, space) => {
    const name = await nameOf(ctx, space.id, target);
    const when = args.when ? new Date(args.when) : new Date();
    if (Number.isNaN(when.getTime())) throw new CrmToolError("Write `when` as ISO 8601, or leave it out for now.");
    const kind = KINDS[args.kind];
    const payload = {
      kind,
      subject: args.subject ?? null,
      body: args.text,
      occurredAt: when.toISOString(),
      direction: args.direction ? (args.direction === "inbound" ? ("INBOUND" as const) : ("OUTBOUND" as const)) : null,
      targets: [target],
    };
    const record = { id: crmItemId(space, target), name, url: recordUrl(space, target) };
    if (connectorAppliesDirectly("LOG_ACTIVITY", session.grant.access)) {
      const activityId = await logActivity(ctx.db, {
        organizationId: space.id,
        kind,
        subject: payload.subject,
        body: payload.body,
        occurredAt: when,
        direction: payload.direction,
        targets: [target],
        actorId: ctx.userId,
        createdById: ctx.userId,
        meta: { via: "connector", client: session.grant.clientName ?? null } as Prisma.InputJsonObject,
      });
      return {
        output: { space: { id: space.id, name: space.name }, status: "applied" as const, suggestionId: null, record, reviewUrl: space.url("/crm/queue"), message: `Logged on ${name}'s timeline.` },
        target: { type: "CrmActivity", id: activityId },
      };
    }
    const { id } = await proposeChange(ctx.db, {
      organizationId: space.id,
      kind: "LOG_ACTIVITY",
      source: "CONNECTOR",
      title: `Log ${args.kind} with ${name}`,
      payload,
      target,
      citation: connectorCitation(session, `logged a ${args.kind}`),
      proposedById: ctx.userId,
      assigneeId: ctx.userId,
    });
    return { output: queued(space, id, record, "It waits in the CRM's Review tab."), target: { type: "CrmSuggestion", id } };
  });
}

const noteInput = z.object({ id: itemArg("CRM record"), text: text(20_000).min(1) });

// ---------------------------------------------------------------- drafts

const draftInput = z.object({
  id: itemArg("CRM person"),
  subject: text(300).min(1),
  body: text(20_000).min(1).describe("Plain text. It is saved as a draft for the member to read, edit and send themselves; it is never sent."),
  why: text(500).optional(),
});

export async function crmDraftEmailTool(session: ConnectorSession, raw: z.input<typeof draftInput>) {
  const args = draftInput.parse(raw);
  const { ref, target } = crmRef(args.id);
  if (target.kind !== "person") throw new NotFoundError();
  return crmWrite(session, "crm_draft_email", ref.spaceId, async (ctx, space) => {
    const person = await ctx.db.crmPerson.findFirst({
      where: { id: target.id, organizationId: space.id, deletedAt: null },
      select: { name: true, primaryEmail: true, doNotContact: true, unsubscribedAt: true },
    });
    if (!person) throw new NotFoundError();
    if (person.doNotContact || person.unsubscribedAt) throw new CrmToolError(`${person.name} asked not to be contacted.`);
    const delivered = await deliverDraft(ctx.db, {
      organizationId: space.id,
      target,
      to: person.primaryEmail ? [person.primaryEmail] : [],
      subject: args.subject,
      body: args.body,
      why: args.why ?? null,
      title: `Email draft to ${person.name}`,
      source: "CONNECTOR",
      citation: connectorCitation(session, "drafted this email"),
      proposedById: ctx.userId,
      assigneeId: ctx.userId,
    });
    const suggestionId = delivered.suggestionId ?? "";
    // The email rules' post-check: the connected app wrote it, so it hears what to fix (no second call here).
    const tells = emailTells(`${args.subject}\n${args.body}`);
    const check = tells.length
      ? ` It reads as machine-written in places (${tells.join(", ")}); the member should edit those before sending.`
      : "";
    return {
      output: queued(space, suggestionId, { id: crmItemId(space, target), name: person.name, url: recordUrl(space, target) }, `The draft waits in the CRM's Review tab and in compose on their page. Nothing was sent.${check}`),
      target: { type: "CrmSuggestion", id: suggestionId },
    };
  });
}

// ---------------------------------------------------------------- lists

const listInput = z.object({
  space: spaceArg,
  name: text(80).min(1).describe('What to call the list ("Alumni in Boston").'),
  kind: z.enum(["people", "companies"]).default("people"),
  relationship: text(80).optional().describe("People only: a relationship type's name (donor, partner, alumni...)."),
  status: z.enum(["ACTIVE", "INACTIVE", "ALUMNI"]).optional(),
  mine: z.boolean().default(false).describe("Only the ones the member owns."),
  followUpDue: z.boolean().default(false).describe("Only those with a follow-up due today or earlier."),
});
const listOutput = z.object({ space: spaceRef, list: z.object({ id: z.string(), name: z.string(), url: urlField }), message: z.string() });

export async function crmBuildListTool(session: ConnectorSession, raw: z.input<typeof listInput>) {
  const args = listInput.parse(raw);
  return crmWrite(session, "crm_build_list", args.space, async (ctx, space) => {
    const filters: { col: string; op: string; value: string }[] = [];
    if (args.relationship && args.kind === "people") {
      const settings = await ctx.db.crmSettings.findUnique({ where: { organizationId: space.id }, select: { relationshipTypes: true } });
      const types = (Array.isArray(settings?.relationshipTypes) ? settings.relationshipTypes : []) as { id: string; label: string }[];
      const type = types.find((t) => t.label.toLowerCase() === args.relationship!.toLowerCase()) ?? types.find((t) => t.label.toLowerCase().includes(args.relationship!.toLowerCase()));
      if (!type) throw new CrmToolError(`There's no relationship type called "${args.relationship.slice(0, 60)}". The organization's types are: ${types.map((t) => t.label).join(", ") || "none"}.`);
      filters.push({ col: "relationship", op: "eq", value: type.id });
    }
    if (args.status) filters.push({ col: "status", op: "eq", value: args.status });
    if (args.mine) filters.push({ col: "owner", op: "eq", value: "me" });
    if (args.followUpDue) filters.push({ col: "followUp", op: "lte", value: "today" });
    const view = await ctx.db.crmView.create({
      data: {
        organizationId: space.id,
        objectKind: args.kind,
        name: args.name,
        filters: filters as unknown as Prisma.InputJsonArray,
        shared: false,
        createdById: ctx.userId,
      },
      select: { id: true },
    });
    return {
      output: {
        space: { id: space.id, name: space.name },
        list: { id: view.id, name: args.name, url: space.url(`/crm/${args.kind}`) },
        message: `Saved "${args.name}" as one of the member's own lists on the CRM's ${args.kind === "people" ? "People" : "Companies"} page.`,
      },
      target: { type: "CrmView", id: view.id },
    };
  });
}

// ---------------------------------------------------------------- registration

export const registerCrmWrites: ToolRegistrar = (server, session) => {
  server.registerTool(
    "crm_create_person",
    {
      title: "Suggest a new CRM person",
      description: "Suggests adding a person to one space's CRM. It waits in the CRM's Review tab until a person accepts it.",
      inputSchema: personInput,
      outputSchema: queuedOutput,
      annotations: ADDS,
    },
    (args) => readResult("crm_create_person", () => crmCreatePersonTool(session, args)),
  );
  server.registerTool(
    "crm_create_company",
    {
      title: "Suggest a new CRM company",
      description: "Suggests adding a company to one space's CRM. It waits in the CRM's Review tab until a person accepts it.",
      inputSchema: companyInput,
      outputSchema: queuedOutput,
      annotations: ADDS,
    },
    (args) => readResult("crm_create_company", () => crmCreateCompanyTool(session, args)),
  );
  server.registerTool(
    "crm_update_record",
    {
      title: "Suggest CRM field changes",
      description: "Suggests changes to a CRM person's, company's or item's fields, shown to the member as a before and after in the Review tab. Nothing changes until a person accepts.",
      inputSchema: updateInput,
      outputSchema: queuedOutput,
      annotations: ADDS,
    },
    (args) => readResult("crm_update_record", () => crmUpdateRecordTool(session, args)),
  );
  server.registerTool(
    "crm_move_stage",
    {
      title: "Suggest a stage move",
      description: "Suggests moving a pipeline item to another stage. It waits in the Review tab until a person accepts.",
      inputSchema: moveInput,
      outputSchema: queuedOutput,
      annotations: ADDS,
    },
    (args) => readResult("crm_move_stage", () => crmMoveStageTool(session, args)),
  );
  server.registerTool(
    "crm_log_activity",
    {
      title: "Log to a CRM timeline",
      description: "Logs an email, call, meeting, text or note on a CRM person's, company's or item's timeline.",
      inputSchema: logInput,
      outputSchema: queuedOutput,
      annotations: ADDS,
    },
    (args) => readResult("crm_log_activity", () => logToTimeline(session, "crm_log_activity", args)),
  );
  server.registerTool(
    "crm_add_note",
    {
      title: "Add a CRM note",
      description: "Adds a note to a CRM person's, company's or item's timeline.",
      inputSchema: noteInput,
      outputSchema: queuedOutput,
      annotations: ADDS,
    },
    (args) => readResult("crm_add_note", () => logToTimeline(session, "crm_add_note", { id: args.id, kind: "note", text: args.text })),
  );
  server.registerTool(
    "crm_build_list",
    {
      title: "Save a CRM list",
      description: "Saves a list of CRM people or companies (a filter) as one of the member's own lists.",
      inputSchema: listInput,
      outputSchema: listOutput,
      annotations: ADDS,
    },
    (args) => readResult("crm_build_list", () => crmBuildListTool(session, args)),
  );
  server.registerTool(
    "crm_draft_email",
    {
      title: "Draft a CRM email",
      description: withEmailStyle(
        "Drafts an email to a CRM person for the member to read, edit and send themselves. It is saved in the Review tab and never sent. Read their timeline (crm_timeline) first and write the subject and body as the member, under these rules.",
      ),
      inputSchema: draftInput,
      outputSchema: queuedOutput,
      annotations: ADDS,
    },
    (args) => readResult("crm_draft_email", () => crmDraftEmailTool(session, args)),
  );
};
