import { z } from "zod";

import {
  ACTION_TYPES,
  actionToMergeSyntax,
  ASSIGN_MODES,
  CONDITION_OPS,
  TRIGGER_TYPES,
  WORKFLOW_FIELDS,
  WORKFLOW_OBJECTS,
  type Condition,
  type Trigger,
  type WorkflowAction,
  type WorkflowObject,
} from "./workflows";

/**
 * "Describe it in words" (docs/features/crm.md, "Describe-it workflows"):
 * the organization's model turns a sentence into When / If / Then, naming
 * pipelines, stages, members and templates by NAME (it never sees ids);
 * this maps those names onto the organization's own and drops what it
 * can't place, saying so, so the draft is always valid and always shown for
 * review before it's switched on. Pure: the server calls the model and
 * hands the answer here.
 */

const name = z.string().max(200).nullable();

export const describedSchema = z.object({
  name: z.string().max(120),
  trigger: z.object({
    type: z.enum(TRIGGER_TYPES),
    object: z.enum(WORKFLOW_OBJECTS).nullable(),
    pipeline: name,
    toStage: name,
    toKind: z.enum(["WON", "LOST"]).nullable(),
    form: name,
    field: name,
    days: z.number().int().nullable(),
    offsetDays: z.number().int().nullable(),
  }),
  conditions: z
    .array(z.object({ field: z.string().max(80), op: z.enum(CONDITION_OPS), value: z.string().max(200).nullable() }))
    .max(10),
  actions: z
    .array(
      z.object({
        type: z.enum(ACTION_TYPES),
        title: name,
        dueInDays: z.number().int().nullable(),
        member: name,
        assignMode: z.enum(ASSIGN_MODES).nullable(),
        field: name,
        value: name,
        pipeline: name,
        stage: name,
        template: name,
        sequence: name,
        event: name,
        message: z.string().max(500).nullable(),
        url: z.string().max(500).nullable(),
        tasks: z.array(z.string().max(200)).max(20).nullable(),
        direction: z.enum(["IN", "OUT"]).nullable(),
      }),
    )
    .max(12),
  /** Anything in the sentence it couldn't turn into a step. */
  unclear: z.string().max(400).nullable(),
});
export type Described = z.infer<typeof describedSchema>;

/** What the organization has, by name, for the model's prompt and the mapping. */
export interface DescribeContext {
  pipelines: { id: string; name: string; itemNoun: string; stages: { id: string; name: string; kind: string }[] }[];
  members: { id: string; name: string }[];
  templates: { id: string; name: string }[];
  sequences: { id: string; name: string }[];
  forms: { id: string; title: string }[];
  events: { id: string; title: string }[];
  relationships: { id: string; label: string }[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The best name match: exact, then one containing the other. */
export function matchName<T>(want: string | null | undefined, items: readonly T[], label: (t: T) => string): T | null {
  if (!want) return null;
  const w = norm(want);
  if (!w) return null;
  return (
    items.find((i) => norm(label(i)) === w) ??
    items.find((i) => norm(label(i)).includes(w) || w.includes(norm(label(i)))) ??
    null
  );
}

function fieldKeyFor(object: WorkflowObject, raw: string | null): string | null {
  if (!raw) return null;
  const w = norm(raw);
  const f = WORKFLOW_FIELDS[object].find((x) => norm(x.key) === w || norm(x.label) === w || norm(x.label).includes(w));
  return f?.key ?? null;
}

/** The model's answer as a workflow draft, plus notes on what was left out. */
export function mapDescribed(
  d: Described,
  ctx: DescribeContext,
): { draft: { name: string; trigger: Trigger; conditions: Condition[]; actions: WorkflowAction[] }; notes: string[] } {
  const notes: string[] = [];
  const t = d.trigger;
  const stageTrigger = t.type === "stage.changed" || t.type === "deal.stuck";
  const object: WorkflowObject = stageTrigger ? "deal" : (t.object ?? "person");
  const pipeline = matchName(t.pipeline, ctx.pipelines, (p) => p.name);
  if (t.pipeline && !pipeline) notes.push(`There's no pipeline called "${t.pipeline}", so it watches every pipeline.`);
  const stage = pipeline && t.toStage ? matchName(t.toStage, pipeline.stages, (s) => s.name) : null;
  if (t.toStage && !stage) notes.push(`Couldn't find the stage "${t.toStage}".`);
  const form = matchName(t.form, ctx.forms, (f) => f.title);
  const params: Trigger["params"] = {};
  if (!stageTrigger) params.object = object;
  if (pipeline && (object === "deal" || stageTrigger)) params.pipelineId = pipeline.id;
  if (stage) params.toStageId = stage.id;
  else if (t.toKind) params.toKind = t.toKind;
  if (form && t.type === "form.submitted") params.formId = form.id;
  if (t.type === "field.changed" || t.type === "date.reached") {
    const key = fieldKeyFor(object, t.field);
    if (key) params.field = key;
    else notes.push(t.field ? `Couldn't find the field "${t.field}".` : "Pick the field it goes by.");
  }
  if ((t.type === "no.activity" || t.type === "deal.stuck") && t.days) params.days = Math.min(730, Math.max(1, t.days));
  if (t.type === "date.reached" && t.offsetDays !== null) params.offsetDays = Math.max(-365, Math.min(365, t.offsetDays));
  const trigger: Trigger = { type: t.type, params };

  const conditions: Condition[] = [];
  for (const c of d.conditions) {
    const key = fieldKeyFor(object, c.field);
    if (!key) {
      notes.push(`Left out the condition on "${c.field}".`);
      continue;
    }
    let value: string | null = c.value;
    if (key === "relationship" && value) value = matchName(value, ctx.relationships, (r) => r.label)?.id ?? value;
    if (key === "owner" && value) value = matchName(value, ctx.members, (m) => m.name)?.id ?? value;
    conditions.push({ field: key, op: c.op, ...(value !== null ? { value } : {}) });
  }

  const actions: WorkflowAction[] = [];
  const member = (n: string | null) => matchName(n, ctx.members, (m) => m.name);
  for (const a of d.actions) {
    switch (a.type) {
      case "task.create": {
        const m = member(a.member);
        actions.push({
          type: a.type,
          params: {
            title: a.title?.trim() || "Follow up with {{name}}",
            ...(a.dueInDays !== null ? { dueInDays: Math.max(0, Math.min(365, a.dueInDays)) } : {}),
            assignTo: m ? "member" : "owner",
            ...(m ? { userId: m.id } : {}),
          },
        });
        break;
      }
      case "field.set": {
        const key = fieldKeyFor(object, a.field);
        if (!key) {
          notes.push(`Left out updating "${a.field ?? "a field"}".`);
          break;
        }
        actions.push({ type: a.type, params: { field: key, value: a.value ?? null } });
        break;
      }
      case "stage.move": {
        const p = pipeline ?? matchName(a.pipeline, ctx.pipelines, (x) => x.name);
        const s = p ? matchName(a.stage, p.stages, (x) => x.name) : null;
        if (!s) {
          notes.push(`Couldn't find the stage "${a.stage ?? ""}" to move to.`);
          break;
        }
        actions.push({ type: a.type, params: { stageId: s.id } });
        break;
      }
      case "owner.assign": {
        const m = member(a.member);
        const mode = a.assignMode ?? (m ? "member" : "round_robin");
        actions.push({ type: a.type, params: { mode, userIds: [], ...(m ? { userId: m.id } : {}) } });
        break;
      }
      case "deal.create": {
        const p = matchName(a.pipeline, ctx.pipelines, (x) => x.name);
        if (!p) {
          notes.push(`There's no pipeline called "${a.pipeline ?? ""}".`);
          break;
        }
        actions.push({ type: a.type, params: { pipelineId: p.id } });
        break;
      }
      case "template.send": {
        const tpl = matchName(a.template, ctx.templates, (x) => x.name) ?? (ctx.templates.length === 1 ? ctx.templates[0]! : null);
        if (!tpl) {
          notes.push(a.template ? `There's no template called "${a.template}".` : "Pick the template to send.");
          break;
        }
        actions.push({ type: a.type, params: { templateId: tpl.id } });
        break;
      }
      case "sequence.enroll": {
        const s = matchName(a.sequence, ctx.sequences, (x) => x.name);
        if (!s) {
          notes.push(a.sequence ? `There's no sequence called "${a.sequence}".` : "Pick the sequence.");
          break;
        }
        actions.push({ type: a.type, params: { sequenceId: s.id } });
        break;
      }
      case "event.invite": {
        const e = matchName(a.event, ctx.events, (x) => x.title);
        if (!e) {
          notes.push(a.event ? `There's no upcoming event called "${a.event}".` : "Pick the event.");
          break;
        }
        actions.push({ type: a.type, params: { eventId: e.id } });
        break;
      }
      case "notify": {
        const m = member(a.member);
        actions.push({
          type: a.type,
          params: { to: m ? "member" : "owner", ...(m ? { userId: m.id } : {}), message: a.message?.trim() || "{{name}} needs a look." },
        });
        break;
      }
      case "slack.post":
      case "discord.post":
      case "webhook.call": {
        const url = a.url?.trim() ?? "";
        if (!/^https:\/\//.test(url)) {
          notes.push(`Add the ${a.type === "slack.post" ? "Slack" : a.type === "discord.post" ? "Discord" : "webhook"} address before switching it on.`);
          break;
        }
        if (a.type === "webhook.call") actions.push({ type: a.type, params: { url } });
        else actions.push({ type: a.type, params: { url, message: a.message?.trim() || "{{name}}: {{link}}" } });
        break;
      }
      case "finance.create":
        actions.push({
          type: a.type,
          params: { direction: a.direction ?? "IN", description: a.title?.trim() || "{{title}}", amountFrom: "item" },
        });
        break;
      case "project.start": {
        const m = member(a.member);
        actions.push({
          type: a.type,
          params: {
            name: a.title?.trim() || "{{title}}",
            tasks: (a.tasks ?? []).filter((x) => x.trim()).slice(0, 30),
            ownerFrom: m ? "member" : "owner",
            ...(m ? { userId: m.id } : {}),
            linkFiles: true,
          },
        });
        break;
      }
    }
  }
  if (d.unclear) notes.push(d.unclear);
  // A model that writes {name} gets the merge fields' {{name}}.
  return { draft: { name: d.name.trim() || "New automation", trigger, conditions, actions: actions.map(actionToMergeSyntax) }, notes };
}

const NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10, fourteen: 14, thirty: 30 };

function daysIn(text: string): number | null {
  const m = /(\d+|one|two|three|four|five|six|seven|ten|fourteen|thirty)\s+(day|week)s?/i.exec(text);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]!) ? Number(m[1]) : (NUMBERS[m[1]!.toLowerCase()] ?? 1);
  return m[2]!.toLowerCase().startsWith("week") ? n * 7 : n;
}

/**
 * The local stand-in's reading (no model): plain keyword rules good enough
 * to try the review screen, e.g. "When someone fills in the volunteer form,
 * add them to Volunteers, assign whoever has the fewest, and remind them in
 * two days".
 */
export function standinDescribe(text: string, ctx: DescribeContext): Described {
  const t = text.toLowerCase();
  const empty = { pipeline: null, toStage: null, toKind: null, form: null, field: null, days: null, offsetDays: null };
  const pipelineNamed = ctx.pipelines.find((p) => t.includes(p.name.toLowerCase()) || t.includes(p.itemNoun.toLowerCase()));
  let trigger: Described["trigger"] = { type: "record.created", object: "person", ...empty };
  if (/form/.test(t)) trigger = { ...trigger, type: "form.submitted", form: ctx.forms.find((f) => t.includes(f.title.toLowerCase()))?.title ?? null };
  else if (/stuck/.test(t)) trigger = { ...trigger, type: "deal.stuck", object: "deal", pipeline: pipelineNamed?.name ?? null, days: daysIn(t) };
  else if (/\b(won|wins|joins|joined|says yes|said yes|received)\b/.test(t))
    trigger = { ...trigger, type: "stage.changed", object: "deal", pipeline: pipelineNamed?.name ?? null, toKind: "WON" };
  else if (/\b(lost|declines|declined)\b/.test(t))
    trigger = { ...trigger, type: "stage.changed", object: "deal", pipeline: pipelineNamed?.name ?? null, toKind: "LOST" };
  else if (/repl(y|ies)/.test(t)) trigger = { ...trigger, type: "email.replied" };
  else if (/book/.test(t)) trigger = { ...trigger, type: "meeting.booked" };
  else if (/(quiet|no contact|haven't|hasn't)/.test(t)) trigger = { ...trigger, type: "no.activity", days: daysIn(t) ?? 30 };
  const actions: Described["actions"] = [];
  const blank = {
    title: null,
    dueInDays: null,
    member: null,
    assignMode: null,
    field: null,
    value: null,
    pipeline: null,
    stage: null,
    template: null,
    sequence: null,
    event: null,
    message: null,
    url: null,
    tasks: null,
    direction: null,
  } as const;
  const addTo = /add (?:them|it|him|her) to (?:the )?([a-z][a-z ]+?)(?:,| and|\.|$)/.exec(t);
  if (addTo && trigger.object !== "deal") actions.push({ ...blank, type: "deal.create", pipeline: addTo[1]!.trim() });
  if (/fewest/.test(t)) actions.push({ ...blank, type: "owner.assign", assignMode: "fewest" });
  else if (/round.?robin|take turns/.test(t)) actions.push({ ...blank, type: "owner.assign", assignMode: "round_robin" });
  if (/welcome|send (?:the|a|them)/.test(t)) actions.push({ ...blank, type: "template.send", template: /welcome/.test(t) ? "Welcome" : null });
  if (/remind|follow up|task/.test(t)) {
    actions.push({ ...blank, type: "task.create", title: "Follow up with {{name}}", dueInDays: daysIn(t) ?? 3 });
  }
  if (/project/.test(t)) actions.push({ ...blank, type: "project.start", title: "{{title}}", tasks: ["Kickoff", "Plan the work"] });
  if (/notify|tell|let .* know|nudge/.test(t)) actions.push({ ...blank, type: "notify", message: "{{name}} needs a look." });
  if (/slack/.test(t)) actions.push({ ...blank, type: "slack.post", message: "{{name}}: {{link}}" });
  if (actions.length === 0) actions.push({ ...blank, type: "task.create", title: "Look at {{name}}", dueInDays: 1 });
  return {
    name: text.replace(/\s+/g, " ").trim().slice(0, 60) || "New automation",
    trigger,
    conditions: [],
    actions,
    unclear: null,
  };
}
