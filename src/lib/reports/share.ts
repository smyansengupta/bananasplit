import type { WidgetPayload } from "./compute";

/**
 * Sharing a report outside the organization (client-safe): the invite
 * addresses an editor types, who an invite lets in, and what a shared view
 * leaves out of each widget.
 */

/** People a report can be shared with by email, at most. */
export const MAX_INVITES = 50;

/** What the share controls say, wherever they are. */
export const SHARE_NOTE = "People you share with see what you see in this report.";

const EMAIL = /^[^\s@,;<>()"]+@[^\s@,;<>()"]+\.[^\s@,;<>()"]+$/;

/** An address as it's stored and compared: trimmed and lowercased. */
export function normalizeInviteEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * The addresses in what someone typed or pasted (commas, semicolons, spaces
 * or new lines between them, "Name <a@b.org>" too), normalized and without
 * repeats, and the bits that aren't addresses.
 */
export function readInviteEmails(text: string): { emails: string[]; bad: string[] } {
  const emails: string[] = [];
  const bad: string[] = [];
  for (const part of text.split(/[\s,;]+/)) {
    const raw = part.replace(/^<|>$/g, "").trim();
    if (!raw) continue;
    const email = normalizeInviteEmail(raw);
    if (email.length <= 254 && EMAIL.test(email)) {
      if (!emails.includes(email)) emails.push(email);
    } else if (raw.includes("@")) {
      // A word without an @ is part of a name ("Sam <sam@x.org>"); skip it.
      bad.push(raw);
    }
  }
  return { emails, bad };
}

/** Is this signed-in address one the report is shared with? */
export function isInvited(email: string | null | undefined, invites: readonly string[]): boolean {
  if (!email) return false;
  const mine = normalizeInviteEmail(email);
  return invites.some((i) => normalizeInviteEmail(i) === mine);
}

/** The keys a shared view drops: links into the organization, addresses, member ids. */
const PRIVATE_KEYS = new Set(["href", "emails", "ownerId"]);

function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (!PRIVATE_KEYS.has(key)) out[key] = strip(v);
    else if (key === "emails") out[key] = [];
    else out[key] = null;
  }
  return out;
}

/**
 * A widget as a shared view shows it: the same numbers, without links into
 * the organization's pages, anyone's address or member ids.
 */
export function sharePayload(payload: WidgetPayload): WidgetPayload {
  return strip(payload) as WidgetPayload;
}
