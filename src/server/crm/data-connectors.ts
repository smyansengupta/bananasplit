import type { IntegrationProvider } from "@/generated/prisma/client";
import { requirePermission } from "@/lib/auth/permissions";
import { assertNoTx, withSystemOrgTx } from "@/server/db/context";
import { sanitize } from "@/server/jobs/sanitize";
import {
  getSecret,
  setSecret,
  testIntegration,
  type IntegrationTestContext,
  type IntegrationTestResult,
  type SecretActor,
} from "@/server/secrets";

/**
 * Bring your own data connectors (docs/features/crm.md, differentiator 8 and
 * module 11): Tavily (web search and page reading), Hunter and Prospeo
 * (people and company lookups), each on the organization's own key, stored
 * as an OrgSecret like every other key. We never pay for a lookup.
 *
 * Every call goes to the provider's fixed address in this file (never a URL
 * from the organization or a model), refuses redirects, has a timeout, and
 * sends the key in a header. A test reads the account's usage (free), which
 * the Integrations card shows as "credits used this month".
 */

export type DataProviderId = "tavily" | "hunter" | "prospeo";

export interface DataProviderInfo {
  id: DataProviderId;
  provider: Extract<IntegrationProvider, "TAVILY" | "HUNTER" | "PROSPEO">;
  label: string;
  /** What it adds, in a line. */
  body: string;
  /** Where to get a key. */
  keyUrl: string;
  /** A light shape check before saving. */
  keyPattern: RegExp;
}

export const DATA_PROVIDERS: readonly DataProviderInfo[] = [
  {
    id: "tavily",
    provider: "TAVILY",
    label: "Tavily",
    body: "Web search for the research agent, enrichment and AI fields.",
    keyUrl: "https://app.tavily.com",
    keyPattern: /^tvly-[A-Za-z0-9_-]{8,200}$/,
  },
  {
    id: "hunter",
    provider: "HUNTER",
    label: "Hunter",
    body: "Titles, companies and socials from an email address or a domain.",
    keyUrl: "https://hunter.io/api-keys",
    keyPattern: /^[A-Za-z0-9]{20,100}$/,
  },
  {
    id: "prospeo",
    provider: "PROSPEO",
    label: "Prospeo",
    body: "People and company details from an email or a LinkedIn profile.",
    keyUrl: "https://app.prospeo.io/api",
    keyPattern: /^[A-Za-z0-9_-]{16,200}$/,
  },
];

export function dataProvider(id: string): DataProviderInfo | null {
  return DATA_PROVIDERS.find((p) => p.id === id) ?? null;
}

export function dataProviderOf(provider: IntegrationProvider): DataProviderInfo | null {
  return DATA_PROVIDERS.find((p) => p.provider === provider) ?? null;
}

const TIMEOUT_MS = 15_000;

/** Test seam: the one fetch every data connector uses. */
export const dataClients = {
  fetch: (url: string, init: RequestInit): Promise<Response> => fetch(url, init),
};

export class DataProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataProviderError";
  }
}

async function call(url: string, init: RequestInit, label: string, signal?: AbortSignal): Promise<unknown> {
  assertNoTx(`${label} request`);
  let res: Response;
  try {
    res = await dataClients.fetch(url, {
      ...init,
      redirect: "error",
      cache: "no-store",
      signal: signal ?? AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new DataProviderError(`${label} took too long to answer.`);
    }
    throw new DataProviderError(`${label} couldn't be reached.`);
  }
  if (res.status === 401 || res.status === 403) throw new DataProviderError(`${label} rejected the API key.`);
  if (res.status === 429) throw new DataProviderError(`${label} is out of credits or rate-limited for now.`);
  if (res.status === 404) return null;
  if (!res.ok) throw new DataProviderError(`${label} answered ${res.status}.`);
  return res.json().catch(() => null);
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown, max = 500): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

// ---------------------------------------------------------------- Tavily

const TAVILY = "https://api.tavily.com";

export interface WebResult {
  title: string;
  url: string;
  content: string;
}

/** One basic search (1 credit): the top results with their text. */
export async function tavilySearch(
  apiKey: string,
  query: string,
  options: { maxResults?: number; topic?: "general" | "news" } = {},
): Promise<WebResult[]> {
  const body = await call(
    `${TAVILY}/search`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        query: query.slice(0, 400),
        search_depth: "basic",
        topic: options.topic ?? "general",
        max_results: Math.min(options.maxResults ?? 5, 10),
        include_answer: false,
        include_raw_content: false,
      }),
    },
    "Tavily",
  );
  const results = Array.isArray(obj(body).results) ? (obj(body).results as unknown[]) : [];
  return results
    .map((r) => {
      const o = obj(r);
      const url = str(o.url, 1000);
      return url && /^https?:\/\//i.test(url)
        ? { title: str(o.title, 300) ?? url, url, content: str(o.content, 2_000) ?? "" }
        : null;
    })
    .filter((r): r is WebResult => r !== null);
}

/** Credits used and the plan's limit, from GET /usage (free). */
export async function tavilyUsage(apiKey: string, signal?: AbortSignal): Promise<{ used: number | null; limit: number | null }> {
  const body = obj(
    await call(`${TAVILY}/usage`, { method: "GET", headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } }, "Tavily", signal),
  );
  const account = obj(body.account);
  const key = obj(body.key);
  return {
    used: num(account.plan_usage) ?? num(key.usage),
    limit: num(account.plan_limit) ?? num(key.limit),
  };
}

// ---------------------------------------------------------------- Hunter

const HUNTER = "https://api.hunter.io/v2";

/** What a lookup found about a person or a company (any may be missing). */
export interface FoundValues {
  title?: string | null;
  companyName?: string | null;
  linkedinUrl?: string | null;
  location?: string | null;
  phone?: string | null;
  website?: string | null;
  domain?: string | null;
  industry?: string | null;
  size?: string | null;
  address?: string | null;
  description?: string | null;
}

function clean(values: FoundValues): FoundValues {
  const out: FoundValues = {};
  for (const [k, v] of Object.entries(values) as [keyof FoundValues, string | null | undefined][]) {
    if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, k === "description" ? 2000 : 500);
  }
  return out;
}

export async function hunterPerson(apiKey: string, email: string): Promise<FoundValues | null> {
  const body = await call(
    `${HUNTER}/combined/find?email=${encodeURIComponent(email)}`,
    { method: "GET", headers: { "X-API-KEY": apiKey, Accept: "application/json" } },
    "Hunter",
  );
  const data = obj(obj(body).data);
  const person = obj(data.person);
  const company = obj(data.company);
  const employment = obj(person.employment);
  const geo = obj(person.geo);
  const linkedin = obj(person.linkedin);
  const found = clean({
    title: str(employment.title),
    companyName: str(employment.name) ?? str(company.name),
    linkedinUrl: str(linkedin.handle) ? `https://www.linkedin.com/${str(linkedin.handle)}` : null,
    location: str(person.location) ?? ([str(geo.city), str(geo.country)].filter(Boolean).join(", ") || null),
    phone: str(person.phone),
    website: str(person.site),
  });
  return Object.keys(found).length ? found : null;
}

export async function hunterCompany(apiKey: string, domain: string): Promise<FoundValues | null> {
  const body = await call(
    `${HUNTER}/companies/find?domain=${encodeURIComponent(domain)}`,
    { method: "GET", headers: { "X-API-KEY": apiKey, Accept: "application/json" } },
    "Hunter",
  );
  const c = obj(obj(body).data);
  const metrics = obj(c.metrics);
  const geo = obj(c.geo);
  const category = obj(c.category);
  const found = clean({
    companyName: str(c.name),
    website: str(c.domain) ? `https://${str(c.domain)}` : null,
    industry: str(category.industry) ?? str(category.sector),
    size: str(metrics.employees) ?? (num(metrics.employees) !== null ? String(num(metrics.employees)) : null),
    address: [str(geo.city), str(geo.state), str(geo.country)].filter(Boolean).join(", ") || null,
    description: str(c.description, 2000),
    phone: str(c.phone),
  });
  return Object.keys(found).length ? found : null;
}

export async function hunterUsage(apiKey: string, signal?: AbortSignal): Promise<{ used: number | null; limit: number | null }> {
  const body = obj(
    await call(`${HUNTER}/account`, { method: "GET", headers: { "X-API-KEY": apiKey, Accept: "application/json" } }, "Hunter", signal),
  );
  const requests = obj(obj(body.data).requests);
  const credits = obj(requests.credits);
  const searches = obj(requests.searches);
  return {
    used: num(credits.used) ?? num(searches.used),
    limit: num(credits.available) ?? num(searches.available),
  };
}

// ---------------------------------------------------------------- Prospeo

const PROSPEO = "https://api.prospeo.io";

export async function prospeoPerson(apiKey: string, input: { email?: string | null; linkedinUrl?: string | null }): Promise<FoundValues | null> {
  const data = input.linkedinUrl ? { linkedin_url: input.linkedinUrl } : input.email ? { email: input.email } : null;
  if (!data) return null;
  const body = await call(
    `${PROSPEO}/enrich-person`,
    {
      method: "POST",
      headers: { "X-KEY": apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ data }),
    },
    "Prospeo",
  );
  const b = obj(body);
  if (b.error === true) return null;
  const person = obj(b.person);
  const company = obj(b.company);
  const location = obj(person.location);
  const found = clean({
    title: str(person.current_job_title) ?? str(person.job_title),
    companyName: str(company.name),
    linkedinUrl: str(person.linkedin_url),
    location: str(location.city) ? [str(location.city), str(location.country)].filter(Boolean).join(", ") : str(person.location),
    website: str(company.website),
    industry: str(company.industry),
    size: str(company.employee_range) ?? (num(company.employee_count) !== null ? String(num(company.employee_count)) : null),
  });
  return Object.keys(found).length ? found : null;
}

export async function prospeoUsage(apiKey: string, signal?: AbortSignal): Promise<{ used: number | null; limit: number | null }> {
  const body = obj(
    await call(
      `${PROSPEO}/account-information`,
      { method: "POST", headers: { "X-KEY": apiKey, "Content-Type": "application/json", Accept: "application/json" }, body: "{}" },
      "Prospeo",
      signal,
    ),
  );
  const r = obj(body.response);
  const remaining = num(r.remaining_credits);
  const used = num(r.used_credits);
  return { used, limit: used !== null && remaining !== null ? used + remaining : null };
}

// ---------------------------------------------------------------- connect, test, keys

function usageReader(id: DataProviderId) {
  return id === "tavily" ? tavilyUsage : id === "hunter" ? hunterUsage : prospeoUsage;
}

/** The test every card's Test button runs: the account's usage, which is free. */
export function connectionTest(id: DataProviderId) {
  return async (ctx: IntegrationTestContext): Promise<IntegrationTestResult> => {
    if (!ctx.secret) return { ok: false, reason: "Add an API key first." };
    try {
      const usage = await usageReader(id)(ctx.secret, ctx.signal);
      return {
        ok: true,
        config: { creditsUsed: usage.used, creditsLimit: usage.limit, creditsCheckedAt: new Date().toISOString() },
      };
    } catch (error) {
      return { ok: false, reason: error instanceof DataProviderError ? error.message : sanitize(error, 200) };
    }
  };
}

export type ConnectResult = { ok: true; message: string } | { ok: false; error: string };

/** Saves (or replaces) a data connector's key and tests it at once. Owners and admins. */
export async function saveDataKey(
  orgId: string,
  actor: SecretActor,
  id: DataProviderId,
  apiKey: string,
): Promise<ConnectResult> {
  requirePermission(actor, "integrations.write");
  const info = dataProvider(id);
  if (!info) return { ok: false, error: "Pick one of the listed providers." };
  const key = apiKey.trim();
  if (!info.keyPattern.test(key)) return { ok: false, error: `That doesn't look like a ${info.label} API key.` };
  await setSecret({ orgId, actor, provider: info.provider, kind: "API_KEY", value: key });
  return testDataKey(orgId, actor, id);
}

export async function testDataKey(orgId: string, actor: SecretActor, id: DataProviderId): Promise<ConnectResult> {
  requirePermission(actor, "integrations.write");
  const info = dataProvider(id);
  if (!info) return { ok: false, error: "Pick one of the listed providers." };
  const result = await testIntegration({ orgId, actor, provider: info.provider, test: connectionTest(id) });
  return result.ok
    ? { ok: true, message: `Connected. ${info.label} answered and its usage is below.` }
    : { ok: false, error: result.reason };
}

export interface DataConnection {
  id: DataProviderId;
  label: string;
  body: string;
  keyUrl: string;
  connected: boolean;
  attention: boolean;
  last4: string | null;
  lastError: string | null;
  checkedAt: string | null;
  creditsUsed: number | null;
  creditsLimit: number | null;
}

/** Each data connector's state, labels only (no key), read on the service path. */
export async function loadDataConnections(orgId: string): Promise<DataConnection[]> {
  const rows = await withSystemOrgTx(orgId, ({ db }) =>
    db.orgIntegration.findMany({
      where: { organizationId: orgId, provider: { in: DATA_PROVIDERS.map((p) => p.provider) } },
      select: { provider: true, status: true, secretFingerprint: true, secretLast4: true, lastError: true, lastVerifiedAt: true, config: true },
    }),
  );
  return DATA_PROVIDERS.map((p) => {
    const row = rows.find((r) => r.provider === p.provider);
    const config = obj(row?.config);
    const has = Boolean(row?.secretFingerprint);
    return {
      id: p.id,
      label: p.label,
      body: p.body,
      keyUrl: p.keyUrl,
      connected: has && row?.status === "CONNECTED",
      attention: has && (row?.status === "ERROR" || row?.status === "NEEDS_REAUTH"),
      last4: row?.secretLast4 ?? null,
      lastError: row?.lastError ?? null,
      checkedAt: row?.lastVerifiedAt?.toISOString() ?? null,
      creditsUsed: num(config.creditsUsed),
      creditsLimit: num(config.creditsLimit),
    };
  });
}

/** The providers this organization can use now, in `order` first, then the rest. */
export async function connectedDataProviders(orgId: string, order: readonly string[] = []): Promise<DataProviderId[]> {
  const list = await loadDataConnections(orgId);
  const on = list.filter((c) => c.connected || c.attention).map((c) => c.id);
  const ordered = order.filter((id): id is DataProviderId => on.includes(id as DataProviderId));
  return [...ordered, ...on.filter((id) => !ordered.includes(id))];
}

/** A connector's key for one request (the caller has authorized the member). */
export async function dataKey(orgId: string, id: DataProviderId): Promise<string | null> {
  const info = dataProvider(id);
  if (!info) return null;
  return getSecret({ orgId, provider: info.provider, kind: "API_KEY" });
}
