/**
 * What a guest types on a public booking page, made safe to keep and to
 * repeat back to them (docs/features/booking.md, "Spam and abuse"). A
 * booking emails whatever address is typed, so nothing the guest types may
 * turn that email into someone else's message: the name is a name (no
 * links, no addresses, no markup), short, and the greeting uses it only
 * when it looks like one. Pure.
 */

export const GUEST_NAME_MAX = 80;
export const ANSWER_MAX = 1000;

/** Control, zero-width and direction-changing characters (by code point, so the source stays plain ASCII). */
const CONTROL = new RegExp(
  `[${[[0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x202a, 0x202e], [0x2066, 0x2069]]
    .map(([a, b]) => `${String.fromCharCode(a!)}-${String.fromCharCode(b!)}`)
    .join("")}]`,
  "g",
);
/** Anything that reads as a link or an address: a scheme, www., an @, a dotted host. */
const LINKISH = /(:\/\/|\bwww\.|@|[a-z0-9-]+\.(?:[a-z]{2,24})(?:\/|\b))/i;
const MARKUP = /[<>{}[\]\\|`$]/;

export type NameCheck = { ok: true; name: string } | { ok: false; error: string };

/** A guest's name, trimmed and checked. */
export function checkGuestName(raw: string): NameCheck {
  const name = raw.replace(CONTROL, "").replace(/\s+/g, " ").trim();
  if (!name) return { ok: false, error: "Add your name." };
  if (name.length > GUEST_NAME_MAX) return { ok: false, error: "That name is too long." };
  if (LINKISH.test(name) || MARKUP.test(name)) {
    return { ok: false, error: "Use just your name, without links or addresses." };
  }
  return { ok: true, name };
}

/** The first word of their name for "Hi Sam,", or null when it isn't plainly a name. */
export function greetingName(name: string): string | null {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return /^[\p{L}\p{M}][\p{L}\p{M}'.-]{0,29}$/u.test(first) ? first : null;
}

/** An answer: no control characters, at most ANSWER_MAX characters. */
export function cleanAnswer(raw: string | undefined): string {
  return (raw ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim()
    .slice(0, ANSWER_MAX);
}

/** Every link-like run: a scheme URL, www., an address, a dotted host. */
const LINKISH_RUN = /\S*(?::\/\/|\bwww\.|@)\S*|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}\b\S*/gi;

/**
 * Words a link's maker typed (its name, the host's name, the space's name),
 * fit to put in an email the platform sends to whatever address a visitor
 * typed: links and addresses taken out, control characters gone, short. So
 * a booking link can't be used to mail a stranger somebody's link.
 */
export function plainForEmail(text: string, max = 80): string {
  const s = text
    .replace(CONTROL, "")
    .replace(LINKISH_RUN, "")
    .replace(/[<>{}[\]\\|`$]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** Whether a typed place reads as a link (then it isn't put in an email). */
export function looksLikeLink(text: string): boolean {
  return LINKISH.test(text);
}

/** "Coffee with Ada Lovelace", or the link's own name when it already says who ("Meet with Ada"). */
export function withHost(title: string, hostName: string): string {
  const first = hostName.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (first && title.toLowerCase().includes(first)) return title;
  return `${title} with ${hostName}`;
}
