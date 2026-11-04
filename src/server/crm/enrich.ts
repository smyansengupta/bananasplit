import { cleanText, EnrichOutput, type EnrichData } from "@/lib/crm/ai-outputs";
import { normalizeEmail, workDomain } from "@/lib/crm/dedupe";
import type { Citation, TargetRef } from "@/lib/crm/suggestions";
import { withSystemOrgTx } from "@/server/db/context";

import { CrmError } from "./access";
import { claudeWebResearch, crmCredentials, dataRule, estimateCallMicros, fenced, holdForCall, runCrmAi, recordAiUsage, reserveUnderCap, withTier, WEB_RESEARCH_SEARCH_MICROS } from "./ai";
import type { AiWho } from "./ai-tx";
import { updateCompany } from "./companies";
import { costOf, meterUse } from "./spend";
import {
  connectedDataProviders,
  dataKey,
  dataProvider,
  DataProviderError,
  hunterCompany,
  hunterPerson,
  prospeoPerson,
  tavilySearch,
  type DataProviderId,
  type FoundValues,
  type WebResult,
} from "./data-connectors";
import { recordEnrichment } from "./enrichment-store";
import { newBatchId } from "./history";
import { updatePerson } from "./people";
import { proposeChange } from "./review";

/**
 * Enrichment (docs/features/crm.md module 4, differentiator 8): the
 * waterfall. Try each connected provider in the organization's order
 * (CrmSettings.enrichmentOrder; by default Hunter, Prospeo, Tavily, then
 * Claude's own web search) until one returns data, paying only for that one.
 *
 * Empty fields are filled at once (field history source "connector", or
 * "ai" when a model read web pages), each with its source and time in the
 * record's enrichment; a value a person already entered is never
 * overwritten: a different one becomes a suggestion in the review queue.
 */

export type WaterfallStep = DataProviderId | "claude";

export const DEFAULT_ORDER: readonly WaterfallStep[] = ["hunter", "prospeo", "tavily", "claude"];

export const STEP_LABELS: Record<WaterfallStep, string> = {
  hunter: "Hunter",
  prospeo: "Prospeo",
  tavily: "Tavily",
  claude: "Claude web search",
};

type Field = keyof FoundValues;

const PERSON_FIELDS: { field: Field; key: string; label: string }[] = [
  { field: "title", key: "title", label: "Title" },
  { field: "companyName", key: "companyName", label: "Company" },
  { field: "linkedinUrl", key: "linkedinUrl", label: "LinkedIn" },
  { field: "location", key: "location", label: "Location" },
  { field: "phone", key: "phone", label: "Phone" },
  { field: "website", key: "website", label: "Website" },
];

const COMPANY_FIELDS: { field: Field; key: string; label: string }[] = [
  { field: "website", key: "website", label: "Website" },
  { field: "domain", key: "domain", label: "Domain" },
  { field: "industry", key: "industry", label: "Industry" },
  { field: "size", key: "size", label: "Size" },
  { field: "address", key: "address", label: "Address" },
  { field: "description", key: "description", label: "About" },
  { field: "phone", key: "phone", label: "Phone" },
];

interface Subject {
  target: TargetRef;
  name: string;
  email: string | null;
  linkedinUrl: string | null;
  domain: string | null;
  companyName: string | null;
  title: string | null;
  current: Record<string, string | null | undefined>;
}

export interface EnrichOutcome {
  provider: WaterfallStep | null;
  tried: { step: WaterfallStep; result: "found" | "nothing" | "skipped" | "error"; detail?: string }[];
  filled: string[];
  suggested: number;
  batchId: string | null;
  /** suggestOnly: the one suggestion holding everything found, and what it would change. */
  suggestionId?: string | null;
  changes?: { field: string; label: string; before: string | null; after: string }[];
  /** Who found it, in words ("Hunter"). */
  providerLabel?: string | null;
}

/** The order to try, from the setting (unknown steps dropped), defaulting to DEFAULT_ORDER. */
export function waterfallOrder(setting: readonly string[]): WaterfallStep[] {
  const known = setting.filter((s): s is WaterfallStep => (DEFAULT_ORDER as readonly string[]).includes(s));
  return known.length ? [...new Set(known)] : [...DEFAULT_ORDER];
}

async function loadSubject(who: AiWho, target: TargetRef): Promise<{ subject: Subject; order: string[] }> {
  return who.tx(async (actor) => {
    const db = actor.db;
    const settings = await db.crmSettings.findUnique({ where: { organizationId: who.organizationId }, select: { enrichmentOrder: true } });
    const order = settings?.enrichmentOrder ?? [];
    if (target.kind === "person") {
      const p = await db.crmPerson.findFirst({
        where: { id: target.id, organizationId: who.organizationId, deletedAt: null },
        include: { company: { select: { name: true, domain: true } } },
      });
      if (!p) throw new CrmError("That person isn't here any more.");
      return {
        order,
        subject: {
          target,
          name: p.name,
          email: p.primaryEmail,
          linkedinUrl: p.linkedinUrl,
          domain: p.company?.domain ?? workDomain(p.primaryEmail),
          companyName: p.company?.name ?? null,
          title: p.title,
          current: {
            title: p.title,
            companyName: p.company?.name ?? null,
            linkedinUrl: p.linkedinUrl,
            location: p.location,
            phone: p.phone,
            website: p.website,
          },
        },
      };
    }
    if (target.kind === "company") {
      const c = await db.crmCompany.findFirst({ where: { id: target.id, organizationId: who.organizationId, deletedAt: null } });
      if (!c) throw new CrmError("That company isn't here any more.");
      return {
        order,
        subject: {
          target,
          name: c.name,
          email: null,
          linkedinUrl: null,
          domain: c.domain ?? workDomain(c.website),
          companyName: c.name,
          title: null,
          current: {
            website: c.website,
            domain: c.domain,
            industry: c.industry,
            size: c.size,
            address: c.address,
            description: c.description,
            phone: c.phone,
          },
        },
      };
    }
    throw new CrmError("Enrichment is for people and companies.");
  });
}

export function enrichSystemPrompt(kind: "person" | "company"): string {
  return `You pull facts about one ${kind} out of web search results, for an organization's CRM.

${dataRule("<subject> and <results>")}

Only use a fact a numbered result states about this exact ${kind} (same name and, when given, company or domain). For each fact give the field, the value (short, as written) and the result number it came from in "source" ("1"). When a result might be about someone else with the same name, leave it out. Never guess.`;
}

function resultsText(results: readonly WebResult[]): string {
  return results.map((r, i) => `${i + 1}. ${r.title}\n${r.url}\n${r.content}`).join("\n\n");
}

/** Facts a model read from numbered results, keeping only those citing a real result. */
function factsFrom(data: EnrichData, results: readonly WebResult[]): { values: FoundValues; urls: Record<string, string> } {
  const values: FoundValues = {};
  const urls: Record<string, string> = {};
  for (const f of data.facts) {
    const n = Number(f.source.replace(/\D/g, ""));
    const r = results[n - 1];
    const v = cleanText(f.value, f.field === "description" ? 1000 : 300);
    if (!r || !v || values[f.field]) continue;
    values[f.field] = v;
    urls[f.field] = r.url;
  }
  return { values, urls };
}

function subjectLine(s: Subject): string {
  return [s.name, s.title, s.companyName && s.target.kind === "person" ? s.companyName : null, s.domain].filter(Boolean).join(", ");
}

/** One step of the waterfall: what it found (or null), and where each value came from. */
async function tryStep(
  who: AiWho,
  step: WaterfallStep,
  s: Subject,
): Promise<{ values: FoundValues; urls: Record<string, string> } | "skip" | null> {
  const kind = s.target.kind === "company" ? "company" : "person";
  if (step === "claude") {
    const creds = await crmCredentials(who.organizationId);
    if (!creds || creds.protocol !== "anthropic") return "skip";
    const tiered = withTier(creds, "fast") as typeof creds;
    // Held against the cap until it's metered: the model plus a few searches.
    const hold = await holdForCall(who.organizationId, tiered, estimateCallMicros(tiered.model, 4_000, 1_000) + 3 * WEB_RESEARCH_SEARCH_MICROS);
    let r;
    try {
      r = await claudeWebResearch(tiered, {
        system: enrichSystemPrompt(kind),
        text: `<subject>\n${fenced(subjectLine(s), "subject")}\n</subject>\n\nSearch the web for this ${kind} and answer with the facts you find. Number the pages you used in the order you cite them; "source" is that number.`,
        schema: EnrichOutput,
        name: "crm_enrich",
        maxOutputTokens: 1_000,
        standin: () => ({ facts: [], notes: [] }),
      });
      const done = r;
      await withSystemOrgTx(who.organizationId, ({ db }) =>
        recordAiUsage(db, { organizationId: who.organizationId, userId: who.userId, feature: "crm.enrich", provider: "claude", result: done, extraMicros: done.webSearchMicros }),
      );
    } finally {
      await hold?.release();
    }
    const results = r.sources.map((x) => ({ title: x.label, url: x.url, content: "" }));
    return factsFrom(r.data, results);
  }
  const key = await dataKey(who.organizationId, step);
  if (!key) return "skip";
  const what = step === "hunter" ? "hunter.lookup" : step === "prospeo" ? "prospeo.lookup" : "tavily.search";
  // Its cost is held against the cap while it runs (calls at once can't all pass a full cap).
  const hold = await reserveUnderCap(who.organizationId, costOf(what));
  try {
    let found: FoundValues | null = null;
    const urls: Record<string, string> = {};
    if (step === "hunter") {
      if (kind === "person") found = s.email ? await hunterPerson(key, s.email) : null;
      else found = s.domain ? await hunterCompany(key, s.domain) : null;
      if (found === null && !(kind === "person" ? s.email : s.domain)) return "skip";
    } else if (step === "prospeo") {
      if (kind === "company" || (!s.email && !s.linkedinUrl)) return "skip";
      found = await prospeoPerson(key, { email: s.email, linkedinUrl: s.linkedinUrl });
    } else {
      const results = await tavilySearch(key, kind === "person" ? `"${s.name}" ${s.companyName ?? ""} ${s.title ?? ""}` : `${s.name} ${s.domain ?? ""} company`, { maxResults: 5 });
      await meterUse({ organizationId: who.organizationId, userId: who.userId, feature: "crm.enrich", provider: "tavily", what: "tavily.search" });
      if (results.length === 0) return null;
      const r = await runCrmAi({
        organizationId: who.organizationId,
        userId: who.userId,
        feature: "crm.enrich",
        request: {
          system: enrichSystemPrompt(kind),
          text: `<subject>\n${fenced(subjectLine(s), "subject")}\n</subject>\n\n<results>\n${fenced(resultsText(results), "results")}\n</results>\n\nList the facts the results state about this ${kind}.`,
          schema: EnrichOutput,
          name: "crm_enrich",
          standin: () => ({ facts: results[0] ? [{ field: kind === "person" ? ("title" as const) : ("description" as const), value: results[0].title.slice(0, 80), source: "1" }] : [], notes: [] }),
        },
      });
      return factsFrom(r.data, results);
    }
    await meterUse({ organizationId: who.organizationId, userId: who.userId, feature: "crm.enrich", provider: step, what });
    return found ? { values: found, urls } : null;
  } finally {
    await hold.release();
  }
}

/**
 * Runs the waterfall on one person or company. `suggestOnly` (a member's
 * "Find their details" on a card): nothing is written; everything found,
 * empty fields and different values alike, becomes one suggestion that
 * changes the record only when someone accepts it.
 */
export async function enrichRecord(
  who: AiWho,
  target: TargetRef,
  options: { suggestOnly?: boolean } = {},
): Promise<EnrichOutcome> {
  const { subject, order } = await loadSubject(who, target);
  const connected = await connectedDataProviders(who.organizationId);
  const steps = waterfallOrder(order).filter((s) => s === "claude" || connected.includes(s));
  const outcome: EnrichOutcome = { provider: null, tried: [], filled: [], suggested: 0, batchId: null };
  let found: { values: FoundValues; urls: Record<string, string> } | null = null;
  for (const step of steps) {
    try {
      const r = await tryStep(who, step, subject);
      if (r === "skip") {
        outcome.tried.push({ step, result: "skipped" });
        continue;
      }
      if (r && Object.keys(r.values).length > 0) {
        outcome.tried.push({ step, result: "found" });
        outcome.provider = step;
        found = r;
        break;
      }
      outcome.tried.push({ step, result: "nothing" });
    } catch (error) {
      outcome.tried.push({
        step,
        result: "error",
        detail: error instanceof DataProviderError || error instanceof Error ? error.message.slice(0, 200) : "failed",
      });
    }
  }
  if (!found || !outcome.provider) return outcome;
  const provider = outcome.provider;
  const viaModel = provider === "tavily" || provider === "claude";
  const fields = target.kind === "person" ? PERSON_FIELDS : COMPANY_FIELDS;
  const fill: Record<string, unknown> = {};
  const conflicts: { field: string; label: string; before: string | null; after: string }[] = [];
  for (const f of fields) {
    const v = found.values[f.field];
    if (!v) continue;
    const value = f.key === "domain" ? (workDomain(v) ?? v.toLowerCase()) : f.key === "primaryEmail" ? normalizeEmail(v) : v;
    if (!value) continue;
    const before = subject.current[f.key];
    if (!before) fill[f.key] = value;
    else if (before.trim().toLowerCase() !== String(value).trim().toLowerCase()) {
      conflicts.push({ field: f.key, label: f.label, before, after: String(value) });
    }
  }
  const label = provider === "claude" ? "Claude web search" : (dataProvider(provider)?.label ?? provider);
  const firstUrl = Object.values(found.urls)[0] ?? null;
  const citation: Citation = { kind: viaModel ? "web" : "connector", label, url: firstUrl };
  outcome.providerLabel = label;
  if (options.suggestOnly) {
    const changes = [
      ...fields
        .filter((f) => f.key in fill)
        .map((f) => ({ field: f.key, label: f.label, before: null, after: String(fill[f.key]) })),
      ...conflicts,
    ];
    outcome.changes = changes;
    outcome.suggestionId = null;
    if (changes.length === 0) return outcome;
    await who.tx(async (actor) => {
      const r = await proposeChange(actor.db, {
        organizationId: who.organizationId,
        kind: "UPDATE_FIELD",
        source: viaModel ? "AI" : "CONNECTOR",
        title: `${label} found details for ${subject.name}`,
        summary: "Nothing changes until you accept.",
        payload: { changes },
        target,
        citation,
        proposedById: who.userId,
        assigneeId: who.userId,
      });
      outcome.suggestionId = r.id;
      outcome.suggested = 1;
    });
    return outcome;
  }
  await who.tx(async (actor) => {
    if (Object.keys(fill).length > 0) {
      const batchId = newBatchId();
      const opts = { source: viaModel ? ("ai" as const) : ("connector" as const), batchId, trusted: true };
      if (target.kind === "person") await updatePerson(actor, target.id, fill, opts);
      else await updateCompany(actor, target.id, fill, opts);
      outcome.batchId = batchId;
      outcome.filled = Object.keys(fill);
      for (const key of outcome.filled) {
        await recordEnrichment(actor.db, who.organizationId, target, [key], provider, { label, url: found!.urls[key] ?? firstUrl }, actor.userId);
      }
    }
    if (conflicts.length > 0) {
      await proposeChange(actor.db, {
        organizationId: who.organizationId,
        kind: "UPDATE_FIELD",
        source: viaModel ? "AI" : "CONNECTOR",
        title: `${label} has different details for ${subject.name}`,
        summary: "Already filled in, so nothing was changed. Accept to use these instead.",
        payload: { changes: conflicts },
        target,
        citation,
        proposedById: who.userId,
        assigneeId: who.userId,
      });
      outcome.suggested = 1;
    }
  });
  return outcome;
}
