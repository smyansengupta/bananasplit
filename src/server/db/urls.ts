/**
 * Runtime connection URLs for the four database roles.
 *
 * The runtime never connects as the table owner: that URL (DATABASE_URL on
 * Neon, or MIGRATE_DATABASE_URL) is for migrations and the seed only, and
 * anything running as the owner bypasses RLS because it owns the tables.
 *
 * Resolution, per role:
 *   1. An explicit DATABASE_URL_APP / _SERVICE / _AUTH (local, CI).
 *   2. Otherwise derived from the base DATABASE_URL (the per-branch URL the
 *      Neon Vercel integration injects, so previews work without per-branch
 *      configuration): same host, port, database and query string, with the
 *      username swapped for the role and the password taken from
 *      APP_DB_PASSWORD / SERVICE_DB_PASSWORD / AUTH_DB_PASSWORD.
 * A role with neither throws: there is deliberately no fallback to the base
 * (owner) URL.
 *
 * This is the only module that reads process.env.DATABASE_URL at runtime
 * (prisma.config.ts and prisma/seed.ts are the other two readers).
 */

export type DbRole = "app" | "service" | "auth";

export const DB_ROLE_NAMES: Record<DbRole, string> = {
  app: "app_user",
  service: "app_service",
  auth: "app_auth",
};

const URL_OVERRIDE_ENV: Record<DbRole, string> = {
  app: "DATABASE_URL_APP",
  service: "DATABASE_URL_SERVICE",
  auth: "DATABASE_URL_AUTH",
};

const PASSWORD_ENV: Record<DbRole, string> = {
  app: "APP_DB_PASSWORD",
  service: "SERVICE_DB_PASSWORD",
  auth: "AUTH_DB_PASSWORD",
};

export class MissingDatabaseUrlError extends Error {
  constructor(role: DbRole) {
    super(
      `No database URL for the ${DB_ROLE_NAMES[role]} role: set ${URL_OVERRIDE_ENV[role]}, ` +
        `or DATABASE_URL plus ${PASSWORD_ENV[role]}.`,
    );
    this.name = "MissingDatabaseUrlError";
  }
}

type Env = Record<string, string | undefined>;

/**
 * Derives the URL for `role` from a base URL: only the username and password
 * change. Exported for tests and /api/health.
 */
export function deriveRoleUrl(baseUrl: string, role: DbRole, password: string): string {
  const url = new URL(baseUrl);
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error(`DATABASE_URL must be a postgres URL (got ${url.protocol})`);
  }
  url.username = DB_ROLE_NAMES[role];
  url.password = password;
  return url.toString();
}

/** The connection URL for `role`, or a MissingDatabaseUrlError. */
export function runtimeDatabaseUrl(role: DbRole, env: Env = process.env): string {
  const explicit = env[URL_OVERRIDE_ENV[role]];
  if (explicit) return explicit;

  const base = env.DATABASE_URL;
  const password = env[PASSWORD_ENV[role]];
  if (!base || !password) {
    throw new MissingDatabaseUrlError(role);
  }
  return deriveRoleUrl(base, role, password);
}

/** The role name a URL logs in as, for the health check (never the password). */
export function usernameOf(url: string): string {
  return decodeURIComponent(new URL(url).username);
}
