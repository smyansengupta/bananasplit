import { peopleQueryOf } from "@/lib/crm/ask-intent";
import { AskAnswerOutput, AskPlanOutput, cleanDay, cleanText, type AskPlan, type AskQuery } from "@/lib/crm/ai-outputs";
import type { TargetKind } from "@/lib/crm/suggestions";
import { safeTimeZone, zonedDateKey } from "@/lib/calendar/dates";

import { CrmError } from "./access";
import { dataRule, fenced, runCrmAi } from "./ai";
import type { AiWho } from "./ai-tx";
import { changesSince, crmCounts, findItems, notContacted, pipelineTotals, recordByName, searchCrm } from "./lookups";
import { timeline } from "./activity";

/**
 * The Ask box on CRM pages (docs/features/crm.md module 10, "Ask questions
 * of the CRM in plain language"). Tool-less and structured:
 *
 *   1. the model reads the question and picks one allowlisted query with
 *      its parameters (AskPlanOutput, checked by zod);
 *   2. we run that query as the member, under their RLS, so the answer can
 *      only ever draw on what they can see in the app;
 *   3. the model writes the answer from the numbered results, citing them,
 *      and the results are shown as links under it.
 *
 * The question and the results are data to the model, never instructions.
 */

export interface AskResultRow {
  n: string;
  kind: TargetKind;
  id: string;
  name: string;
  sub: string | null;
}

export interface AskResponse {
  answer: string;
  results: AskResultRow[];
  cites: string[];
  query: AskQuery;
  readBy: string;
  /** People's own filters that show the same people, when there are (the Ask card's "Open these people"). */
  peopleQuery: Record<string, string> | null;
}


const MAX_QUESTION = 500;

export function planSystemPrompt(opts: { today: string; pipelines: string; relationships: string }): string {
  return `You turn a member's question about their organization's CRM into one query from a fixed list. You never answer the question here.

${dataRule("<question>")}

Today is ${opts.today}. The organization's pipelines and their stages:
${opts.pipelines || "none yet"}
Relationship types: ${opts.relationships || "none"}.

Queries:
- find_people: people matching search words, a relationship type, or not contacted in "days".
- find_companies: companies matching search words, or not contacted in "days".
- find_items: pipeline items, by pipeline and stage, openOnly for ones not closed.
- going_cold: people (kind person) or companies nobody has talked to in "days" days (default 60).
- pipeline_summary: counts and amounts per stage of a pipeline (or all).
- timeline_of: what happened with one record, by its name and kind.
- changes_since: what changed with one record (name, kind) since a day (YYYY-MM-DD; "Monday" is the last Monday before today).
- counts: how many people, companies, open items and follow-ups due.

Set every field: null (or false) when the question doesn't give it. onlyMine when the question says "my" or "mine".`;
}

export function answerSystemPrompt(today: string): string {
  return `You answer a member's question about their organization's CRM from query results the app ran for them.

${dataRule("<question> and <results>")}

Today is ${today}. Answer in one to four plain sentences, from the results only. Name people and companies as the results do and put the result numbers you used in "cites" ("r1"). If the results are empty, say nothing matched and suggest one way to ask differently. Never invent records, numbers or dates.`;
}

const STOP = new Set(["who", "what", "which", "the", "a", "an", "is", "are", "at", "in", "with", "of", "do", "we", "our", "my", "me", "show", "find", "list", "people", "person", "companies", "company", "any", "all", "to", "for", "and", "have", "has", "know"]);

/** No AI: a keyword guess at the query. */
export function standinPlan(question: string): AskPlan {
  const q = question.toLowerCase();
  const days = Number(/(\d{1,4})\s*(day|days|d\b)/.exec(q)?.[1] ?? /(\d{1,2})\s*months?/.exec(q)?.[1]);
  const months = /months?/.test(q) && !/days?/.test(q);
  const base: AskPlan = {
    query: "find_people",
    search: null,
    name: null,
    kind: null,
    pipeline: null,
    stage: null,
    relationship: null,
    days: null,
    since: null,
    onlyMine: /\b(my|mine)\b/.test(q),
    openOnly: false,
  };
  if (/haven'?t|not (talked|spoken|contacted)|going cold|quiet|lost touch/.test(q)) {
    return { ...base, query: "going_cold", kind: /compan/.test(q) ? "company" : "person", days: Number.isFinite(days) && days > 0 ? (months ? days * 30 : days) : 60 };
  }
  if (/pipeline|stage|how much|total|forecast/.test(q)) return { ...base, query: "pipeline_summary" };
  if (/how many/.test(q)) return { ...base, query: "counts" };
  const words = q
    .replace(/[^a-z0-9@.\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w));
  if (/changed|since/.test(q)) return { ...base, query: "changes_since", name: words.filter((w) => w !== "changed" && w !== "since").join(" ") || null, since: null };
  if (/compan/.test(question.toLowerCase())) return { ...base, query: "find_companies", search: words.join(" ") || null };
  return { ...base, search: words.join(" ") || null };
}

function daysAgo(key: string, n: number): Date {
  return new Date(new Date(`${key}T00:00:00Z`).getTime() - n * 86_400_000);
}

interface Ran {
  rows: AskResultRow[];
  /** One line per result, numbered, for the model. */
  lines: string[];
}

function rowsOf(hits: { kind: TargetKind; id: string; name: string; sub: string | null }[], extra: (i: number) => string = () => ""): Ran {
  const rows = hits.map((h, i) => ({ n: `r${i + 1}`, kind: h.kind, id: h.id, name: h.name, sub: h.sub }));
  return { rows, lines: rows.map((r, i) => `${r.n}: ${r.kind === "deal" ? "item" : r.kind} ${r.name}${r.sub ? ` (${r.sub})` : ""}${extra(i)}`) };
}

/** Runs the plan as the member. */
async function runPlan(who: AiWho, plan: AskPlan, today: string): Promise<Ran> {
  return who.tx(async (actor) => {
    const db = actor.db;
    const org = who.organizationId;
    const mine = plan.onlyMine ? who.userId : null;
    const days = plan.days && plan.days > 0 ? Math.min(plan.days, 3650) : null;
    switch (plan.query) {
      case "find_people":
      case "find_companies": {
        const kind = plan.query === "find_people" ? "person" : "company";
        if (days) {
          const hits = await notContacted(db, org, { days, kind, ownerId: mine, includeNever: true });
          return rowsOf(hits, (i) => `, last contacted ${hits[i]?.lastContactedAt ? zonedDateKey(hits[i]!.lastContactedAt!, "UTC") : "never"}`);
        }
        let hits = await searchCrm(db, org, plan.search ?? "", [kind], 20);
        if (plan.relationship && kind === "person") {
          const settings = await db.crmSettings.findUnique({ where: { organizationId: org }, select: { relationshipTypes: true } });
          const types = (Array.isArray(settings?.relationshipTypes) ? settings.relationshipTypes : []) as { id: string; label: string }[];
          const type = types.find((t) => t.label.toLowerCase().includes(plan.relationship!.toLowerCase()));
          if (type) {
            const rows = await db.crmPerson.findMany({
              where: { organizationId: org, deletedAt: null, relationship: type.id, ...(mine ? { ownerId: mine } : {}) },
              take: 20,
              select: { id: true, name: true, title: true },
            });
            hits = rows.map((r) => ({ kind: "person", id: r.id, name: r.name, sub: r.title, lastContactedAt: null }));
          }
        }
        return rowsOf(hits);
      }
      case "going_cold": {
        const hits = await notContacted(db, org, { days: days ?? 60, kind: plan.kind === "company" ? "company" : "person", ownerId: mine });
        return rowsOf(hits, (i) => `, last contacted ${hits[i]?.lastContactedAt ? zonedDateKey(hits[i]!.lastContactedAt!, "UTC") : "never"}`);
      }
      case "find_items": {
        const items = await findItems(db, org, { pipeline: plan.pipeline, stage: plan.stage, openOnly: plan.openOnly, ownerId: mine, search: plan.search });
        return rowsOf(
          items.map((d) => ({ kind: "deal" as const, id: d.id, name: d.title, sub: `${d.pipeline}, ${d.stage}${d.amount ? `, ${d.amount}` : ""}` })),
          (i) => (items[i]?.nextStep ? `, next step: ${items[i]!.nextStep}` : ""),
        );
      }
      case "pipeline_summary": {
        const totals = await pipelineTotals(db, org, plan.pipeline);
        return { rows: [], lines: totals.map((t) => `${t.pipeline}, ${t.stage} (${t.kind.toLowerCase()}): ${t.count}${t.amount ? `, ${t.amount}` : ""}`) };
      }
      case "counts": {
        const c = await crmCounts(db, org);
        return { rows: [], lines: [`people: ${c.people}`, `companies: ${c.companies}`, `open items: ${c.openItems}`, `people with a follow-up due: ${c.followUpsDue}`] };
      }
      case "timeline_of":
      case "changes_since": {
        const found = plan.name ? await recordByName(db, org, plan.name, plan.kind === "item" ? "deal" : plan.kind) : null;
        if (!found) return { rows: [], lines: [] };
        const head: AskResultRow = { n: "r1", kind: found.target.kind, id: found.target.id, name: found.name, sub: null };
        if (plan.query === "timeline_of") {
          const entries = await timeline(db, org, found.target, { take: 15 });
          return {
            rows: [head],
            lines: [`r1: ${found.name}`, ...entries.map((e) => `[${zonedDateKey(e.occurredAt, "UTC")}] ${e.kind.toLowerCase()}: ${cleanText(e.subject, 150) ?? ""}${e.body ? ` | ${cleanText(e.body, 300)}` : ""}`)],
          };
        }
        const since = cleanDay(plan.since) ? new Date(`${cleanDay(plan.since)}T00:00:00Z`) : daysAgo(today, 7);
        const ch = await changesSince(db, org, found.target, since);
        return {
          rows: [head],
          lines: [
            `r1: ${found.name}, changes since ${zonedDateKey(since, "UTC")}`,
            ...ch.history.map((h) => `[${zonedDateKey(h.changedAt, "UTC")}] ${h.field}: ${JSON.stringify(h.oldValue)} -> ${JSON.stringify(h.newValue)} (${h.source})`),
            ...ch.timeline.map((e) => `[${zonedDateKey(e.occurredAt, "UTC")}] ${e.kind.toLowerCase()}: ${cleanText(e.subject, 150) ?? ""}`),
          ],
        };
      }
    }
  });
}

/** Answers one question about the CRM the member can see. */
export async function askCrm(who: AiWho, question: string): Promise<AskResponse> {
  const q = cleanText(question, MAX_QUESTION);
  if (!q) throw new CrmError("Ask a question first.");
  const env = await who.tx(async (actor) => {
    const org = await actor.db.organization.findUnique({ where: { id: who.organizationId }, select: { timezone: true } });
    const pipelines = await actor.db.crmPipeline.findMany({
      where: { organizationId: who.organizationId, archivedAt: null },
      orderBy: { sortOrder: "asc" },
      take: 20,
      select: { name: true, stages: { orderBy: { sortOrder: "asc" }, select: { name: true } } },
    });
    const settings = await actor.db.crmSettings.findUnique({ where: { organizationId: who.organizationId }, select: { relationshipTypes: true } });
    const types = (Array.isArray(settings?.relationshipTypes) ? settings.relationshipTypes : []) as { id?: string; label?: string }[];
    return {
      types,
      today: zonedDateKey(new Date(), safeTimeZone(org?.timezone)),
      pipelines: pipelines.map((p) => `- ${p.name}: ${p.stages.map((s) => s.name).join(", ")}`).join("\n"),
      relationships: types.map((t) => t.label).filter(Boolean).join(", "),
    };
  });
  const wrapped = `<question>\n${fenced(q, "question")}\n</question>`;
  const plan = await runCrmAi({
    organizationId: who.organizationId,
    userId: who.userId,
    feature: "crm.ask",
    request: {
      system: planSystemPrompt(env),
      text: `${wrapped}\n\nPick the query.`,
      schema: AskPlanOutput,
      name: "crm_ask_plan",
      maxOutputTokens: 400,
      standin: () => standinPlan(q),
    },
  });
  const ran = await runPlan(who, plan.data, env.today);
  const answer = await runCrmAi({
    organizationId: who.organizationId,
    userId: who.userId,
    feature: "crm.ask",
    creds: plan.creds,
    request: {
      system: answerSystemPrompt(env.today),
      text: `${wrapped}\n\n<results>\n${fenced(ran.lines.join("\n") || "No results.", "results")}\n</results>\n\nAnswer the question.`,
      schema: AskAnswerOutput,
      name: "crm_ask_answer",
      standin: () => ({
        answer: ran.lines.length
          ? `Found ${ran.rows.length || ran.lines.length}: ${(ran.rows.length ? ran.rows.map((r) => r.name) : ran.lines).slice(0, 5).join("; ")}.`
          : "Nothing matched. Try a name, a pipeline, or \"who haven't we talked to in 60 days\".",
        cites: ran.rows.slice(0, 5).map((r) => r.n),
      }),
    },
  });
  const known = new Set(ran.rows.map((r) => r.n));
  return {
    answer: cleanText(answer.data.answer, 1500) ?? "",
    results: ran.rows,
    cites: answer.data.cites.filter((c) => known.has(c)),
    query: plan.data.query,
    readBy: answer.label,
    peopleQuery: ran.rows.some((r) => r.kind === "person") ? peopleQueryOf(plan.data, env.types) : null,
  };
}
