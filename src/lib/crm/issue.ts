import { z } from "zod";

import { cleanText } from "@/lib/crm/ai-outputs";

/**
 * A person's biggest issue (docs/features/crm.md, "Notes and tasks"): one
 * line saying what they're most unhappy with or most need, kept on the
 * person's enrichment as `_issue` and read by Reports to count the top
 * issues across people. The AI writes it from their notes, replies, calls
 * and meetings, and writes it again only when those changed: the digest of
 * what it read is kept beside it as `_issueSeen`. A member can edit or
 * clear it; then it's theirs (model null, no sources) until something new
 * comes in. Pure and client-safe.
 */

/** Exactly this shape: Reports reads it. `sources` are the timeline entries (CrmActivity ids) it came from. */
export interface StoredIssue {
  text: string;
  at: string;
  model: string | null;
  sources: string[];
}

export const ISSUE_KEY = "_issue";
export const ISSUE_SEEN_KEY = "_issueSeen";

export const IssueOutput = z.object({
  /** One plain line, or null when nothing they wrote or said shows a problem or a need. */
  issue: z.string().nullable(),
  /** The ids of the entries it comes from, as given in <timeline>. */
  sourceIds: z.array(z.string()),
  notes: z.array(z.string()),
});
export type IssueData = z.infer<typeof IssueOutput>;

export interface IssueSource {
  id: string;
  kind: string;
  direction?: string | null;
  subject: string | null;
  body: string | null;
  occurredAt: Date | string;
}

/** The entries an issue is read from: notes, calls and meetings, and what they sent us (replies, texts). */
export function countsForIssue(kind: string, direction: string | null | undefined): boolean {
  if (kind === "NOTE" || kind === "CALL" || kind === "MEETING") return true;
  return (kind === "EMAIL" || kind === "TEXT") && direction === "INBOUND";
}

/** At most this many, newest first. */
export const ISSUE_SOURCES_MAX = 25;

export function issueSources<T extends IssueSource>(entries: readonly T[]): T[] {
  return entries
    .filter(
      (e) =>
        countsForIssue(e.kind, e.direction) &&
        Boolean((e.body ?? "").trim() || (e.subject ?? "").trim()),
    )
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
    .slice(0, ISSUE_SOURCES_MAX);
}

/** A short fingerprint of what the issue would be read from (FNV-1a, 52 bits): the same content gives the same digest. */
export function issueDigest(sources: readonly IssueSource[]): string {
  const text = sources
    .map((s) => `${s.id}\u0001${s.subject ?? ""}\u0001${s.body ?? ""}`)
    .join("\u0002");
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return `${sources.length}:${h1.toString(36)}${(h2 & 0xfffff).toString(36)}`;
}

/**
 * Whether to ask the AI again: only when there's something to read and it
 * changed since the last time (or someone asked).
 */
export function shouldRefreshIssue(
  seen: unknown,
  digest: string,
  sourceCount: number,
  options: { force?: boolean } = {},
): { refresh: boolean; why: "empty" | "same" | "changed" | "asked" } {
  if (sourceCount === 0) return { refresh: false, why: "empty" };
  if (options.force) return { refresh: true, why: "asked" };
  if (typeof seen === "string" && seen === digest) return { refresh: false, why: "same" };
  return { refresh: true, why: "changed" };
}

export function parseStoredIssue(raw: unknown): StoredIssue | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const text = typeof r.text === "string" ? cleanText(r.text.replace(/\s+/g, " "), 200) : null;
  if (!text) return null;
  const at = typeof r.at === "string" && !Number.isNaN(Date.parse(r.at)) ? r.at : null;
  if (!at) return null;
  return {
    text,
    at,
    model: typeof r.model === "string" && r.model ? r.model.slice(0, 100) : null,
    sources: Array.isArray(r.sources)
      ? [
          ...new Set(
            r.sources.filter(
              (s): s is string => typeof s === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(s),
            ),
          ),
        ].slice(0, 10)
      : [],
  };
}

/** A person's issue from their enrichment, or null. */
export function readIssue(
  enrichment: Record<string, unknown> | null | undefined,
): StoredIssue | null {
  return parseStoredIssue(enrichment?.[ISSUE_KEY]);
}

const NONE = /^(none|null|n\/a|no (clear |obvious )?(issue|problem|complaint)s?( found)?\.?)$/i;

/** The model's answer as what's stored: one line, sources only from what it was shown. Null when it found none. */
export function issueFromAnswer(
  data: IssueData,
  meta: { validIds: readonly string[]; model: string | null; now: Date },
): StoredIssue | null {
  const text = cleanText((data.issue ?? "").replace(/\s+/g, " ").replace(/^["“]|["”]$/g, ""), 160);
  if (!text || NONE.test(text)) return null;
  const valid = new Set(meta.validIds);
  return {
    text,
    at: meta.now.toISOString(),
    model: meta.model,
    sources: [...new Set(data.sourceIds.filter((id) => valid.has(id)))].slice(0, 10),
  };
}

/**
 * What to keep after the AI read again: its new line; or, when it found
 * none, a member's own line stays and an old AI one goes.
 */
export function issueAfterRefresh(
  current: StoredIssue | null,
  next: StoredIssue | null,
): StoredIssue | null {
  if (next) return next;
  return current && current.model === null ? current : null;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? `a ${one}` : `${n} ${many}`);

/** "From 2 notes and a reply": where the line came from, for the card. */
export function issueSourceLabel(
  issue: Pick<StoredIssue, "model" | "sources">,
  kinds: readonly { kind: string; direction?: string | null }[],
): string {
  if (issue.model === null && issue.sources.length === 0) return "Written by hand";
  const notes = kinds.filter((k) => k.kind === "NOTE").length;
  const replies = kinds.filter(
    (k) => (k.kind === "EMAIL" || k.kind === "TEXT") && k.direction === "INBOUND",
  ).length;
  const calls = kinds.filter((k) => k.kind === "CALL").length;
  const meetings = kinds.filter((k) => k.kind === "MEETING").length;
  const parts = [
    notes ? plural(notes, "note", "notes") : null,
    replies ? plural(replies, "reply", "replies") : null,
    calls ? plural(calls, "call", "calls") : null,
    meetings ? plural(meetings, "meeting", "meetings") : null,
  ].filter((p): p is string => Boolean(p));
  if (parts.length === 0) return "From their timeline";
  const list =
    parts.length === 1
      ? parts[0]!
      : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `From ${list}`;
}
