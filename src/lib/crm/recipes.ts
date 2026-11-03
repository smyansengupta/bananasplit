import type { SetupKind } from "./templates";
import type { Condition, Trigger, WorkflowAction } from "./workflows";

/**
 * Ready-made automations (docs/features/crm.md, module 6): switched on in
 * one click. A recipe names pipelines, stages and templates by reference,
 * resolved against the organization's own when it's switched on:
 *
 *   "@pipeline:donors"         the pipeline made from the donors template
 *   "@stage:donors:RECEIVED"   that pipeline's stage with that key
 *   "@template:welcome"        an email template of that category (a
 *                              starter one is made when there's none)
 *
 * A recipe whose pipeline the organization doesn't have says so instead of
 * switching on.
 */

export interface Recipe {
  id: string;
  title: string;
  /** One line under it: what it does, in plain words. */
  description: string;
  /** Icon name (@/components/icons). */
  icon: string;
  /** The pipeline template it needs, if any. */
  needs?: SetupKind;
  trigger: Trigger;
  conditions: Condition[];
  actions: WorkflowAction[];
}

export const STARTER_TEMPLATES: Record<string, { name: string; subject: string; body: string }> = {
  welcome: {
    name: "Welcome",
    subject: "Welcome, {{first_name}}",
    body: "Hi {{first_name}},\n\nThanks for your interest in {{organization}}. We'd love to tell you more: reply to this email with a good time to talk, or come along to our next event.\n\n{{sender_name}}",
  },
  receipt: {
    name: "Thank you and receipt",
    subject: "Thank you for your gift, {{first_name}}",
    body: "Hi {{first_name}},\n\nThank you for your generous gift to {{organization}}. This email is your receipt.\n\nWith thanks,\n{{sender_name}}",
  },
};

export const RECIPES: readonly Recipe[] = [
  {
    id: "interest-form",
    title: "Someone fills in the interest form",
    description: "Add them to New members, assign whoever has the fewest, send the welcome email, follow up in 3 days.",
    icon: "UserPlus",
    needs: "members",
    trigger: { type: "form.submitted", params: { object: "person" } },
    conditions: [],
    actions: [
      { type: "deal.create", params: { pipelineId: "@pipeline:members" } },
      { type: "owner.assign", params: { mode: "fewest", userIds: [] } },
      { type: "template.send", params: { templateId: "@template:welcome" } },
      { type: "field.set", params: { field: "nextFollowUpAt", value: "+3d" } },
      { type: "task.create", params: { title: "Follow up with {name}", dueInDays: 3, assignTo: "owner" } },
    ],
  },
  {
    id: "donor-gave",
    title: "A donor gave",
    description: "A thank-you task for the owner, the receipt email, then move it to Thanked.",
    icon: "HandCoins",
    needs: "donors",
    trigger: { type: "stage.changed", params: { pipelineId: "@pipeline:donors", toStageId: "@stage:donors:RECEIVED" } },
    conditions: [],
    actions: [
      { type: "task.create", params: { title: "Thank {name} for their gift", dueInDays: 2, assignTo: "owner", priority: "HIGH" } },
      { type: "template.send", params: { templateId: "@template:receipt" } },
      { type: "stage.move", params: { stageId: "@stage:donors:THANKED" } },
    ],
  },
  {
    id: "client-yes",
    title: "A client said yes",
    description: "Start the project: its tasks, its owner and the item's files, in Tasks.",
    icon: "Briefcase",
    needs: "clients",
    trigger: { type: "stage.changed", params: { pipelineId: "@pipeline:clients", toKind: "WON" } },
    conditions: [],
    actions: [
      {
        type: "project.start",
        params: {
          name: "{title}",
          tasks: ["Kickoff meeting with {company}", "Agree the scope and dates", "Send the first invoice", "Share the files with the team"],
          ownerFrom: "owner",
          dueInDays: 14,
          linkFiles: true,
        },
      },
      { type: "notify", params: { to: "owner", message: "{title} is won: the project is in Tasks." } },
    ],
  },
  {
    id: "stuck-nudge",
    title: "An item is stuck",
    description: "Nudge its owner when it sits in one stage past that stage's limit.",
    icon: "Hourglass",
    trigger: { type: "deal.stuck", params: {} },
    conditions: [],
    actions: [{ type: "notify", params: { to: "owner", message: "{title} has sat in {stage} for {days} days. What's next?" } }],
  },
  {
    id: "new-sponsor",
    title: "A new sponsor commits",
    description: "Make the deliverables tasks: logo, thank-you post, recap, linked to the sponsorship.",
    icon: "Handshake",
    needs: "sponsors",
    trigger: { type: "stage.changed", params: { pipelineId: "@pipeline:sponsors", toStageId: "@stage:sponsors:COMMITTED" } },
    conditions: [],
    actions: [
      {
        type: "project.start",
        params: {
          name: "{title} deliverables",
          tasks: ["Put {company}'s logo on the website", "Post a thank-you to {company}", "Send {company} the recap after the event"],
          ownerFrom: "owner",
          dueInDays: 30,
          linkFiles: true,
        },
      },
    ],
  },
  {
    id: "speaker-confirmed",
    title: "A speaker confirms",
    description: "A task to brief them a week out, and a note to the owner.",
    icon: "Mic",
    needs: "speakers",
    trigger: { type: "stage.changed", params: { pipelineId: "@pipeline:speakers", toStageId: "@stage:speakers:CONFIRMED" } },
    conditions: [],
    actions: [
      { type: "task.create", params: { title: "Brief {name}: time, place, audience", dueInDays: 7, assignTo: "owner" } },
      { type: "notify", params: { to: "owner", message: "{name} confirmed. The briefing task is yours." } },
    ],
  },
  {
    id: "pledge-reminder",
    title: "Someone pledges",
    description: "Set a next step in two weeks to check the pledge has come in.",
    icon: "PiggyBank",
    needs: "donors",
    trigger: { type: "stage.changed", params: { pipelineId: "@pipeline:donors", toStageId: "@stage:donors:PLEDGED" } },
    conditions: [],
    actions: [
      { type: "field.set", params: { field: "nextStep", value: "Check the pledge has come in" } },
      { type: "field.set", params: { field: "nextStepAt", value: "+14d" } },
    ],
  },
  {
    id: "applicant-joined",
    title: "An applicant joins",
    description: "Tell the owner, and a task to welcome them in person.",
    icon: "UserPlus",
    needs: "members",
    trigger: { type: "stage.changed", params: { pipelineId: "@pipeline:members", toKind: "WON" } },
    conditions: [],
    actions: [
      { type: "task.create", params: { title: "Welcome {name} at the next meeting", dueInDays: 7, assignTo: "owner" } },
      { type: "notify", params: { to: "owner", message: "{name} joined." } },
    ],
  },
  {
    id: "grant-submitted",
    title: "A grant goes in",
    description: "A next step in 30 days to check on the decision.",
    icon: "PiggyBank",
    needs: "grants",
    trigger: { type: "stage.changed", params: { pipelineId: "@pipeline:grants", toStageId: "@stage:grants:SUBMITTED" } },
    conditions: [],
    actions: [
      { type: "field.set", params: { field: "nextStep", value: "Check on the decision" } },
      { type: "field.set", params: { field: "nextStepAt", value: "+30d" } },
    ],
  },
  {
    id: "vendor-booked",
    title: "A venue or vendor is booked",
    description: "Put the cost in Finance as a draft expense for a treasurer to check.",
    icon: "Package",
    needs: "vendors",
    trigger: { type: "stage.changed", params: { pipelineId: "@pipeline:vendors", toKind: "WON" } },
    conditions: [{ field: "amount", op: "gt", value: 0 }],
    actions: [{ type: "finance.create", params: { direction: "OUT", description: "{title}", amountFrom: "item" } }],
  },
  {
    id: "quiet-donor",
    title: "A donor goes quiet",
    description: "After 60 days with no contact, a task for their owner to check in.",
    icon: "Hourglass",
    needs: "donors",
    trigger: { type: "no.activity", params: { object: "person", days: 60 } },
    conditions: [{ field: "relationship", op: "is", value: "donor" }],
    actions: [{ type: "task.create", params: { title: "Check in with {name}", dueInDays: 3, assignTo: "owner" } }],
  },
  {
    id: "follow-up-due",
    title: "A follow-up comes due",
    description: "On the follow-up day, a task for the owner.",
    icon: "AlarmClock",
    trigger: { type: "date.reached", params: { object: "person", field: "nextFollowUpAt", offsetDays: 0 } },
    conditions: [],
    actions: [{ type: "task.create", params: { title: "Follow up with {name}", dueInDays: 0, assignTo: "owner" } }],
  },
];

export function recipeById(id: string): Recipe | undefined {
  return RECIPES.find((r) => r.id === id);
}

/** A reference string ("@pipeline:donors", "@stage:donors:RECEIVED", "@template:welcome"), parsed. */
export type RecipeRef =
  | { kind: "pipeline"; template: string }
  | { kind: "stage"; template: string; key: string }
  | { kind: "template"; category: string };

export function parseRef(value: unknown): RecipeRef | null {
  if (typeof value !== "string" || !value.startsWith("@")) return null;
  const [kind, a, b] = value.slice(1).split(":");
  if (kind === "pipeline" && a) return { kind, template: a };
  if (kind === "stage" && a && b) return { kind, template: a, key: b };
  if (kind === "template" && a) return { kind, category: a };
  return null;
}

/** Every ref in a value (deep), for checking what a recipe needs. */
export function refsIn(value: unknown): RecipeRef[] {
  const out: RecipeRef[] = [];
  const walk = (v: unknown) => {
    const r = parseRef(v);
    if (r) out.push(r);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(value);
  return out;
}

/** The value with every ref replaced (`resolve` returns null when it can't: the whole thing is then null). */
export function resolveRefs<T>(value: T, resolve: (ref: RecipeRef) => string | null): T | null {
  let missing = false;
  const walk = (v: unknown): unknown => {
    const r = parseRef(v);
    if (r) {
      const got = resolve(r);
      if (got === null) missing = true;
      return got;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  const out = walk(value) as T;
  return missing ? null : out;
}
