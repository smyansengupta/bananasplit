/**
 * Profile links (User.links): up to 8 entries of { kind, url }. Pure and
 * client-safe; the same rules validate the form, the Server Action and
 * every read, so a malformed stored value is dropped, never rendered.
 *
 * - Only http and https URLs, at most 300 characters, no user:password@.
 * - A bare "github.com/ada" gets https:// in front.
 * - Network kinds must point at their own site (a "GitHub" link that goes
 *   to another host is refused); website and other take any host.
 * - Rendered with rel="noopener noreferrer nofollow" (ProfileLinks).
 */

export const LINK_KINDS = [
  "linkedin",
  "github",
  "website",
  "instagram",
  "tiktok",
  "x",
  "other",
] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export const MAX_LINKS = 8;
export const MAX_LINK_URL_LENGTH = 300;

export interface ProfileLink {
  kind: LinkKind;
  url: string;
}

export const LINK_KIND_META: Record<
  LinkKind,
  { label: string; hosts?: readonly string[]; example: string }
> = {
  linkedin: {
    label: "LinkedIn",
    hosts: ["linkedin.com"],
    example: "https://www.linkedin.com/in/your-name",
  },
  github: { label: "GitHub", hosts: ["github.com"], example: "https://github.com/your-handle" },
  website: { label: "Website", example: "https://your-site.com" },
  instagram: {
    label: "Instagram",
    hosts: ["instagram.com"],
    example: "https://instagram.com/your-handle",
  },
  tiktok: {
    label: "TikTok",
    hosts: ["tiktok.com"],
    example: "https://www.tiktok.com/@your-handle",
  },
  x: { label: "X", hosts: ["x.com", "twitter.com"], example: "https://x.com/your-handle" },
  other: { label: "Other", example: "https://..." },
};

export function isLinkKind(value: unknown): value is LinkKind {
  return typeof value === "string" && (LINK_KINDS as readonly string[]).includes(value);
}

function hostMatches(hostname: string, host: string): boolean {
  return hostname === host || hostname.endsWith(`.${host}`);
}

export type LinkResult = { ok: true; url: string } | { ok: false; error: string };

/** Validates and normalizes one link URL for `kind`. */
export function normalizeLinkUrl(kind: LinkKind, input: string): LinkResult {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "Enter a URL." };
  if (/\s/.test(raw)) return { ok: false, error: "A URL cannot contain spaces." };
  // "github.com/ada" -> "https://github.com/ada"; anything with another
  // scheme (javascript:, data:, mailto:) is refused below.
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, error: "That doesn't look like a URL." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, error: "Links must start with https:// or http://." };
  }
  if (url.username || url.password) {
    return { ok: false, error: "Links cannot contain a user name or password." };
  }
  const hostname = url.hostname.toLowerCase();
  if (!hostname.includes(".") || hostname.endsWith(".")) {
    return { ok: false, error: "Use a full address, like example.com." };
  }
  const hosts = LINK_KIND_META[kind].hosts;
  if (hosts && !hosts.some((host) => hostMatches(hostname, host))) {
    return {
      ok: false,
      error: `A ${LINK_KIND_META[kind].label} link must be on ${hosts.join(" or ")}.`,
    };
  }
  const normalized = url.toString();
  if (normalized.length > MAX_LINK_URL_LENGTH) {
    return { ok: false, error: `Links are limited to ${MAX_LINK_URL_LENGTH} characters.` };
  }
  return { ok: true, url: normalized };
}

/**
 * The displayable links in a stored User.links value: well-formed entries
 * only, at most MAX_LINKS. Never throws.
 */
export function parseStoredLinks(raw: unknown): ProfileLink[] {
  if (!Array.isArray(raw)) return [];
  const out: ProfileLink[] = [];
  for (const entry of raw) {
    if (out.length >= MAX_LINKS) break;
    if (!entry || typeof entry !== "object") continue;
    const { kind, url } = entry as { kind?: unknown; url?: unknown };
    if (!isLinkKind(kind) || typeof url !== "string") continue;
    const result = normalizeLinkUrl(kind, url);
    if (result.ok) out.push({ kind, url: result.url });
  }
  return out;
}

/** A short label for a link: the kind, or the host for website/other. */
export function linkDisplayText(link: ProfileLink): string {
  if (link.kind === "website" || link.kind === "other") {
    try {
      const url = new URL(link.url);
      const path = url.pathname === "/" ? "" : url.pathname;
      return `${url.hostname.replace(/^www\./, "")}${path}`.slice(0, 60);
    } catch {
      return LINK_KIND_META[link.kind].label;
    }
  }
  return LINK_KIND_META[link.kind].label;
}
