import { appOrigin } from "@/lib/app-url";
import { getClient } from "@/server/db/clients";
import { DB_ROLE_NAMES, type DbRole } from "@/server/db/urls";
import { emailConfigProblems, emailDelivery } from "@/server/email/config";
import { kekFingerprint, loadKeyring } from "@/server/secrets/keyring";
import { blobStoreIdFromToken } from "@/server/storage/drivers";

/**
 * The deploy-time safety checks behind /api/health (0A preview isolation,
 * 0B role and session defaults, Fix 17 email). Any failure makes the route
 * answer 503, so a deploy with a wrong role, a missing role default, a
 * drifted security manifest or a preview wired to production credentials
 * never serves traffic quietly.
 *
 * On every runtime URL (app_user, app_service, app_auth):
 *   - it logs in as that role, which is not a superuser, has no BYPASSRLS
 *     and owns no relation in public;
 *   - SHOW timezone / statement_timeout / idle_in_transaction_session_timeout
 *     are UTC / 15s / 15s (the role defaults the 0B migration sets).
 * On the service role: app.security_manifest() returns no rows.
 * On VERCEL_ENV=preview: the database carries app.fixture_only = 'on'; mail
 *   is not live; the Blob stores and the KEK keyring are the preview ones
 *   (PREVIEW_BLOB_STORE_ID, PREVIEW_PUBLIC_BLOB_STORE_ID,
 *   PREVIEW_KEK_FINGERPRINT, SECRETS_KEK_ENV=preview).
 * On VERCEL_ENV=production: email is configured (or deliberately off), and
 *   CRON_SECRET and the secrets keyring are present.
 */

export interface HealthCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface HealthReport {
  ok: boolean;
  checks: HealthCheck[];
}

type Env = Record<string, string | undefined>;

export interface RoleProbe {
  currentUser: string;
  superuser: boolean;
  bypassRls: boolean;
  ownedRelations: number;
  timezone: string;
  statementTimeout: string;
  idleInTransactionTimeout: string;
}

/** The database side, replaceable in tests. */
export interface HealthProbes {
  role(role: DbRole): Promise<RoleProbe>;
  manifest(): Promise<string[]>;
  fixtureOnly(): Promise<string | null>;
}

export const databaseProbes: HealthProbes = {
  async role(role) {
    const rows = await getClient(role).$queryRaw<
      {
        current_user: string;
        rolsuper: boolean;
        rolbypassrls: boolean;
        owned: number;
        tz: string;
        st: string;
        it: string;
      }[]
    >`
      SELECT current_user::text AS current_user, r.rolsuper, r.rolbypassrls,
             (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public' AND c.relowner = r.oid) AS owned,
             current_setting('TimeZone') AS tz,
             current_setting('statement_timeout') AS st,
             current_setting('idle_in_transaction_session_timeout') AS it
        FROM pg_roles r WHERE r.rolname = current_user`;
    const row = rows[0];
    if (!row) throw new Error("role not found");
    return {
      currentUser: row.current_user,
      superuser: row.rolsuper,
      bypassRls: row.rolbypassrls,
      ownedRelations: Number(row.owned),
      timezone: row.tz,
      statementTimeout: row.st,
      idleInTransactionTimeout: row.it,
    };
  },
  async manifest() {
    const rows = await getClient("service").$queryRaw<{ v: string }[]>`
      SELECT check_name || ' ' || object_name AS v FROM app.security_manifest()`;
    return rows.map((r) => r.v);
  },
  async fixtureOnly() {
    const rows = await getClient("service").$queryRaw<{ v: string | null }[]>`
      SELECT current_setting('app.fixture_only', true) AS v`;
    return rows[0]?.v ?? null;
  },
};

const ROLES: DbRole[] = ["app", "service", "auth"];

async function timed<T>(ms: number, work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 200) : "failed";
}

async function roleChecks(probes: HealthProbes): Promise<HealthCheck[]> {
  return Promise.all(
    ROLES.map(async (role): Promise<HealthCheck> => {
      const name = `role:${DB_ROLE_NAMES[role]}`;
      try {
        const p = await timed(5_000, probes.role(role));
        const problems: string[] = [];
        if (p.currentUser !== DB_ROLE_NAMES[role]) problems.push(`logs in as ${p.currentUser}`);
        if (p.superuser) problems.push("is a superuser");
        if (p.bypassRls) problems.push("has BYPASSRLS");
        if (p.ownedRelations > 0) problems.push(`owns ${p.ownedRelations} relation(s) in public`);
        if (!/^(UTC|Etc\/UTC)$/i.test(p.timezone)) problems.push(`timezone is ${p.timezone}`);
        if (p.statementTimeout !== "15s") problems.push(`statement_timeout is ${p.statementTimeout}`);
        if (p.idleInTransactionTimeout !== "15s") {
          problems.push(`idle_in_transaction_session_timeout is ${p.idleInTransactionTimeout}`);
        }
        return { name, ok: problems.length === 0, detail: problems.join("; ") || undefined };
      } catch (error) {
        return { name, ok: false, detail: describe(error) };
      }
    }),
  );
}

async function manifestCheck(probes: HealthProbes): Promise<HealthCheck> {
  try {
    const rows = await timed(8_000, probes.manifest());
    return {
      name: "security_manifest",
      ok: rows.length === 0,
      detail: rows.length ? `${rows.length} violation(s): ${rows.slice(0, 5).join(", ")}` : undefined,
    };
  } catch (error) {
    return { name: "security_manifest", ok: false, detail: describe(error) };
  }
}

async function previewChecks(probes: HealthProbes, env: Env): Promise<HealthCheck[]> {
  const checks: HealthCheck[] = [];
  try {
    const marker = await timed(5_000, probes.fixtureOnly());
    checks.push({
      name: "preview:fixture_only",
      ok: marker === "on",
      detail: marker === "on" ? undefined : "database is not marked app.fixture_only = 'on'",
    });
  } catch (error) {
    checks.push({ name: "preview:fixture_only", ok: false, detail: describe(error) });
  }

  const delivery = emailDelivery(env);
  checks.push({
    name: "preview:email_sink",
    ok: delivery !== "live",
    detail: delivery === "live" ? "previews must not deliver real mail" : undefined,
  });

  for (const [name, tokenVar, expectedVar] of [
    ["preview:blob_private", "BLOB_READ_WRITE_TOKEN", "PREVIEW_BLOB_STORE_ID"],
    ["preview:blob_public", "BLOB_PUBLIC_READ_WRITE_TOKEN", "PREVIEW_PUBLIC_BLOB_STORE_ID"],
  ] as const) {
    const storeId = blobStoreIdFromToken(env[tokenVar]);
    if (!storeId) {
      checks.push({ name, ok: true, detail: "no Blob token (local driver)" });
      continue;
    }
    const expected = env[expectedVar];
    checks.push({
      name,
      ok: Boolean(expected) && storeId.toLowerCase() === expected?.toLowerCase(),
      detail: expected ? (storeId.toLowerCase() === expected.toLowerCase() ? undefined : "store is not the preview store") : `${expectedVar} is not set`,
    });
  }

  try {
    const fingerprint = kekFingerprint(loadKeyring(env));
    const expected = env.PREVIEW_KEK_FINGERPRINT;
    const problems: string[] = [];
    if (env.SECRETS_KEK_ENV !== "preview") problems.push("SECRETS_KEK_ENV is not 'preview'");
    if (!expected) problems.push("PREVIEW_KEK_FINGERPRINT is not set");
    else if (expected !== fingerprint) problems.push("KEK is not the preview keyring");
    checks.push({ name: "preview:kek", ok: problems.length === 0, detail: problems.join("; ") || undefined });
  } catch (error) {
    checks.push({ name: "preview:kek", ok: false, detail: describe(error) });
  }
  return checks;
}

function productionChecks(env: Env): HealthCheck[] {
  const checks: HealthCheck[] = [];
  const email = emailConfigProblems(env);
  checks.push({ name: "production:email", ok: email.length === 0, detail: email.join("; ") || undefined });
  checks.push({
    name: "production:cron_secret",
    ok: Boolean(env.CRON_SECRET),
    detail: env.CRON_SECRET ? undefined : "CRON_SECRET is not set",
  });
  try {
    loadKeyring(env);
    const hasFingerprintKey = Boolean(env.SECRETS_FINGERPRINT_KEY);
    checks.push({
      name: "production:secrets",
      ok: hasFingerprintKey && env.SECRETS_KEK_ENV !== "preview",
      detail: !hasFingerprintKey
        ? "SECRETS_FINGERPRINT_KEY is not set"
        : env.SECRETS_KEK_ENV === "preview"
          ? "production is using the preview keyring"
          : undefined,
    });
  } catch (error) {
    checks.push({ name: "production:secrets", ok: false, detail: describe(error) });
  }
  try {
    const origin = appOrigin(env);
    checks.push({
      name: "production:app_url",
      ok: Boolean(env.NEXT_PUBLIC_APP_URL) && origin.startsWith("https://"),
      detail: env.NEXT_PUBLIC_APP_URL ? undefined : "NEXT_PUBLIC_APP_URL is not set",
    });
  } catch (error) {
    checks.push({ name: "production:app_url", ok: false, detail: describe(error) });
  }
  return checks;
}

export async function runHealthChecks(
  probes: HealthProbes = databaseProbes,
  env: Env = process.env,
): Promise<HealthReport> {
  const [roles, manifest, preview] = await Promise.all([
    roleChecks(probes),
    manifestCheck(probes),
    env.VERCEL_ENV === "preview" ? previewChecks(probes, env) : Promise.resolve([]),
  ]);
  const checks = [
    ...roles,
    manifest,
    ...preview,
    ...(env.VERCEL_ENV === "production" ? productionChecks(env) : []),
  ];
  return { ok: checks.every((c) => c.ok), checks };
}
