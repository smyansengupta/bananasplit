/**
 * Live collaboration settings (docs/features/collaboration.md).
 *
 * OFF unless all three are set: COLLAB_ENABLED="true", COLLAB_SERVER_URL (a
 * wss:// URL, or ws:// on localhost) and COLLAB_SECRET (at least 32
 * characters, shared with the collaboration server). A half-configured
 * deployment keeps today's autosave editor instead of failing, and says why
 * once in the server log. Read at request time by the note page, the note
 * actions, the bridge routes and the CSP; never inlined into the client
 * bundle (the browser receives the URL together with its token).
 */

export interface CollabConfig {
  /** Where browsers connect, without a trailing slash. */
  url: string;
  /** The URL's origin, for the CSP's connect-src. */
  origin: string;
  /** The same host over http(s), for server-to-server calls (/revoke). */
  httpUrl: string;
  /** Signs tokens and bridge requests; never leaves the server. */
  secret: string;
}

type Env = Record<string, string | undefined>;

export const COLLAB_SECRET_MIN_LENGTH = 32;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Why an enabled configuration is unusable (empty when it is fine or off). */
export function collabConfigProblems(env: Env = process.env): string[] {
  if (env.COLLAB_ENABLED !== "true") return [];
  const problems: string[] = [];
  if ((env.COLLAB_SECRET ?? "").length < COLLAB_SECRET_MIN_LENGTH) {
    problems.push(`COLLAB_SECRET must be at least ${COLLAB_SECRET_MIN_LENGTH} characters`);
  }
  const url = parseUrl(env.COLLAB_SERVER_URL);
  if (!url) {
    problems.push("COLLAB_SERVER_URL is not a URL");
  } else if (!isAllowedServerUrl(url)) {
    problems.push("COLLAB_SERVER_URL must be wss:// (ws:// only on localhost)");
  }
  return problems;
}

/** TLS everywhere but this machine (production also upgrades ws:// through the CSP). */
function isAllowedServerUrl(url: URL): boolean {
  return url.protocol === "wss:" || (url.protocol === "ws:" && LOCAL_HOSTS.has(url.hostname));
}

let warned = false;

/** The configuration when live collaboration is on and usable, else null. */
export function collabConfig(env: Env = process.env): CollabConfig | null {
  if (env.COLLAB_ENABLED !== "true") return null;
  const problems = collabConfigProblems(env);
  if (problems.length > 0) {
    if (!warned) {
      warned = true;
      console.warn(`[collab] COLLAB_ENABLED is set but ignored: ${problems.join("; ")}`);
    }
    return null;
  }
  const url = parseUrl(env.COLLAB_SERVER_URL) as URL;
  const base = `${url.origin}${url.pathname}`.replace(/\/+$/, "");
  return {
    url: base,
    origin: url.origin,
    httpUrl: base.replace(/^ws/, "http"),
    secret: env.COLLAB_SECRET as string,
  };
}

function parseUrl(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
