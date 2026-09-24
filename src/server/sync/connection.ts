import pg from "pg";
import { z } from "zod";

import { assertNoTx } from "@/server/db/context";

/**
 * The website data-source connection (Phase 4b, 'Meaning of "Supabase
 * connection"' decision).
 *
 * OrgIntegration (provider SUPABASE_SOURCE).config holds non-secret,
 * structured fields only:
 *   projectRef    the Supabase project ref (20 lowercase letters)
 *   poolerRegion  e.g. us-east-1
 *   poolerPrefix  aws-0 or aws-1 (both pooler host families exist)
 *   roleName      default cbc_suite_reader
 * and the password is the integration's DB_PASSWORD OrgSecret, read through
 * the secrets accessor inside the job. The host and user are DERIVED:
 *   host  {poolerPrefix}-{poolerRegion}.pooler.supabase.com, port 5432
 *         (session mode)
 *   user  {roleName}.{projectRef}
 * so no free-form host ever reaches a socket (SSRF closed by construction).
 *
 * TLS is verify-full: the certificate must chain to a trusted CA and match
 * the derived host. The Supabase root CA is taken from SUPABASE_ROOT_CA_PEM
 * when set (the connection spike records whether the pooler needs it); it
 * is never turned off.
 *
 * Local development only: with SOURCE_SYNC_ALLOW_LOCAL=1 (and never on
 * Vercel), config { mode: "local", host: "localhost" | "127.0.0.1", port,
 * database } connects to a local stand-in database without TLS, so the
 * sync can be exercised end to end against a copy of the website schema.
 *
 * Every connection is read only (default_transaction_read_only), has a 10s
 * statement timeout and is used by one job at a time. assertNoTx makes sure
 * it is never opened inside a suite transaction.
 */

export const SUPABASE_POOLER_PORT = 5432;
export const STATEMENT_TIMEOUT_MS = 10_000;

const remoteConfig = z.object({
  mode: z.literal("supabase").optional(),
  projectRef: z.string().regex(/^[a-z0-9]{20}$/, "The project ref is the 20-character id in the project URL."),
  poolerRegion: z.string().regex(/^[a-z]{2}-[a-z]+-\d$/, "Pick the project's region, e.g. us-east-1."),
  poolerPrefix: z.enum(["aws-0", "aws-1"]).default("aws-0"),
  roleName: z
    .string()
    .regex(/^[a-z_][a-z0-9_]{0,62}$/)
    .default("cbc_suite_reader"),
});

const localConfig = z.object({
  mode: z.literal("local"),
  host: z.enum(["localhost", "127.0.0.1"]),
  port: z.coerce.number().int().min(1).max(65535).default(5432),
  database: z.string().regex(/^[A-Za-z0-9_]{1,63}$/),
  roleName: z
    .string()
    .regex(/^[a-z_][a-z0-9_]{0,62}$/)
    .default("cbc_suite_reader"),
});

export type SourceConfig =
  | ({ kind: "supabase" } & z.infer<typeof remoteConfig>)
  | ({ kind: "local" } & z.infer<typeof localConfig>);

export class SourceConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceConfigError";
  }
}

/** Whether the local stand-in mode is allowed in this process. */
export function localSourceAllowed(env: Record<string, string | undefined> = process.env): boolean {
  return env.SOURCE_SYNC_ALLOW_LOCAL === "1" && !env.VERCEL && !env.VERCEL_ENV;
}

/** Validates OrgIntegration.config into a connection description. */
export function parseSourceConfig(
  config: unknown,
  env: Record<string, string | undefined> = process.env,
): SourceConfig {
  const obj = (config && typeof config === "object" ? config : {}) as Record<string, unknown>;
  if (obj.mode === "local") {
    if (!localSourceAllowed(env)) {
      throw new SourceConfigError("Local data sources are only allowed in local development.");
    }
    const parsed = localConfig.safeParse(obj);
    if (!parsed.success) throw new SourceConfigError(parsed.error.issues[0]?.message ?? "Invalid local source.");
    return { kind: "local", ...parsed.data };
  }
  const parsed = remoteConfig.safeParse(obj);
  if (!parsed.success) {
    throw new SourceConfigError(parsed.error.issues[0]?.message ?? "The website data source is not set up.");
  }
  return { kind: "supabase", ...parsed.data };
}

/** The derived host and user (shown in Settings; never taken from input). */
export function sourceEndpoint(cfg: SourceConfig): { host: string; port: number; user: string; database: string } {
  if (cfg.kind === "local") {
    return { host: cfg.host, port: cfg.port, user: cfg.roleName, database: cfg.database };
  }
  return {
    host: `${cfg.poolerPrefix}-${cfg.poolerRegion}.pooler.supabase.com`,
    port: SUPABASE_POOLER_PORT,
    user: `${cfg.roleName}.${cfg.projectRef}`,
    database: "postgres",
  };
}

function rootCa(env: Record<string, string | undefined>): string | undefined {
  const pem = env.SUPABASE_ROOT_CA_PEM?.replace(/\\n/g, "\n").trim();
  return pem && pem.includes("BEGIN CERTIFICATE") ? pem : undefined;
}

/** The pg client options for a source (exported for tests). */
export function clientOptions(
  cfg: SourceConfig,
  password: string,
  env: Record<string, string | undefined> = process.env,
): pg.ClientConfig {
  const ep = sourceEndpoint(cfg);
  return {
    host: ep.host,
    port: ep.port,
    user: ep.user,
    database: ep.database,
    password,
    ssl:
      cfg.kind === "local"
        ? false
        : { rejectUnauthorized: true, servername: ep.host, ...(rootCa(env) ? { ca: rootCa(env) } : {}) },
    statement_timeout: STATEMENT_TIMEOUT_MS,
    query_timeout: STATEMENT_TIMEOUT_MS + 5_000,
    connectionTimeoutMillis: 10_000,
    application_name: "cbc-suite-source-sync",
  };
}

/** A connected, read-only client. Always close it with `end()`. */
export async function openSourceClient(cfg: SourceConfig, password: string): Promise<pg.Client> {
  assertNoTx("source sync connection");
  const client = new pg.Client(clientOptions(cfg, password));
  // A dropped connection must not crash the process: the job's next query fails instead.
  client.on("error", () => undefined);
  await client.connect();
  try {
    await client.query("SET default_transaction_read_only = on");
  } catch (error) {
    await client.end().catch(() => undefined);
    throw error;
  }
  return client;
}

/** The contract versions this suite understands. */
export const SUPPORTED_CONTRACT_VERSIONS = [1] as const;

/**
 * Settings > Integrations "Test connection" for the data source: connect,
 * check the contract version, close. Pass it as `test` to testIntegration
 * (src/server/secrets) with kind DB_PASSWORD.
 */
export async function testSupabaseSource(input: {
  secret: string | null;
  config: Record<string, unknown>;
}): Promise<{ ok: true; config?: Record<string, unknown> } | { ok: false; reason: string }> {
  if (!input.secret) return { ok: false, reason: "Save the reader password first." };
  let cfg: SourceConfig;
  try {
    cfg = parseSourceConfig(input.config);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Invalid settings." };
  }
  let client: pg.Client | null = null;
  try {
    client = await openSourceClient(cfg, input.secret);
    const r = await client.query<{ v: number }>("SELECT suite_export.contract_version() AS v");
    const version = Number(r.rows[0]?.v);
    if (!(SUPPORTED_CONTRACT_VERSIONS as readonly number[]).includes(version)) {
      return { ok: false, reason: `The website export is version ${version}; this suite understands version 1.` };
    }
    return { ok: true, config: { contractVersion: version } };
  } catch (error) {
    return { ok: false, reason: describeConnectionError(error) };
  } finally {
    await client?.end().catch(() => undefined);
  }
}

/** A short, sanitized reason for a failed connection (no host secrets, no password). */
export function describeConnectionError(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  const message = error instanceof Error ? error.message : String(error);
  if (code === "28P01" || /password authentication failed/i.test(message)) {
    return "The website database refused the password for the reader role.";
  }
  if (code === "42883" || /suite_export/i.test(message)) {
    return "The website database has no suite export. Apply supabase/suite-export.sql first.";
  }
  if (code === "42501") return "The reader role is missing a grant. Re-apply supabase/suite-export.sql.";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "The pooler host was not found. Check the region and prefix.";
  if (code === "ECONNREFUSED" || code === "ETIMEDOUT") return "The website database did not answer.";
  if (/certificate|self[- ]signed|TLS|SSL/i.test(message)) {
    return "The TLS certificate could not be verified. Set SUPABASE_ROOT_CA_PEM to the Supabase root CA.";
  }
  if (/timeout/i.test(message)) return "The website database took too long to answer.";
  return "Could not read from the website database.";
}
