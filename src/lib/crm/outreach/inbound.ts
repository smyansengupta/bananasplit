/**
 * Reading incoming mail (docs/features/crm.md, "Email connections"): the
 * pure part of ingestEmail. Every way mail comes in (the BCC address,
 * replies to our Reply-To, later Gmail, Outlook and IMAP) is turned into
 * one InboundMessage first; these read it: whose addresses are on it,
 * which of ours it was sent to, whether it's an out-of-office or a bounce,
 * what the reply says without the quoted thread, and who signed it.
 */

export interface InboundMessage {
  /** The Message-ID header, without angle brackets. */
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  from: string;
  to: string[];
  cc: string[];
  /** Envelope recipients (the Worker's message.to), when different from the headers. */
  envelopeTo?: string[];
  subject: string;
  text: string;
  html?: string | null;
  date: Date | null;
  /** Lowercased header names: auto-submitted, x-autoreply, precedence, content-type... */
  headers: Record<string, string>;
}

/** "Ada Lovelace <Ada@Example.org>" -> "ada@example.org"; null when there's no address. */
export function bareAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /<([^<>\s]+@[^<>\s]+)>/.exec(value) ?? /([^\s<>",;]+@[^\s<>",;]+)/.exec(value);
  return m ? m[1]!.trim().toLowerCase().replace(/^mailto:/, "") : null;
}

/** "Ada Lovelace <ada@x.org>" -> "Ada Lovelace". */
export function displayNameOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /^\s*"?([^"<]+?)"?\s*</.exec(value);
  const name = m?.[1]?.trim();
  return name && !name.includes("@") ? name : null;
}

/** Every address in a header list ("a@x, B <b@y>"). */
export function addressList(values: readonly string[] | string | null | undefined): string[] {
  const list = typeof values === "string" ? values.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/) : (values ?? []);
  const out: string[] = [];
  for (const v of list) {
    const a = bareAddress(v);
    if (a && !out.includes(a)) out.push(a);
  }
  return out;
}

/** <id@host> -> id@host */
export function cleanMessageId(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim().replace(/^<|>$/g, "").trim();
  return v && v.length <= 500 ? v : null;
}

const LOCAL = /^([a-z0-9]+)\+([A-Za-z0-9_-]{8,64})@(.+)$/;

/**
 * Our own addresses on the message: log+{token}@{domain} (a member's BCC
 * address) and reply+{token}@{domain} (the Reply-To of an email we sent).
 */
export function ourAddresses(
  addresses: readonly string[],
  inboundDomain: string,
): { bcc: string[]; reply: string[] } {
  const domain = inboundDomain.trim().toLowerCase();
  const out = { bcc: [] as string[], reply: [] as string[] };
  for (const a of addresses) {
    const m = LOCAL.exec(a);
    if (!m || m[3] !== domain) continue;
    if (m[1] === "log") out.bcc.push(m[2]!);
    if (m[1] === "reply") out.reply.push(m[2]!);
  }
  return out;
}

/** The domain of an address. */
export function domainOfAddress(address: string): string {
  return address.slice(address.lastIndexOf("@") + 1).toLowerCase();
}

/** A never-log entry ("@bank.com", "doctor@x.org", "family.net") matches an address. */
export function neverLogged(address: string, neverLog: readonly string[]): boolean {
  const a = address.toLowerCase();
  const d = domainOfAddress(a);
  return neverLog.some((raw) => {
    const n = raw.trim().toLowerCase();
    if (!n) return false;
    if (n.includes("@") && !n.startsWith("@")) return n === a;
    const domain = n.replace(/^@/, "");
    return d === domain || d.endsWith(`.${domain}`);
  });
}

// ---- Out of office ------------------------------------------------------------------

const OOO_SUBJECT = /\b(out of (the )?office|automatic reply|auto-?reply|autoreply|away from (my|the) (desk|office)|on (vacation|leave|holiday)|abwesenheit|absence)\b/i;
const OOO_BODY = /\b(out of (the )?office|i am away|i'm away|on (vacation|leave|holiday|annual leave)|limited access to (my )?email|will (be )?(back|return)|returning on)\b/i;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * The date someone says they're back ("back on March 4", "returning
 * 3/4/2027", "until Monday, March 4"), or null. Dates already past are
 * moved to next year.
 */
export function returnDate(text: string, now: Date = new Date()): Date | null {
  const t = text.toLowerCase();
  const near = /(back|return(ing)?|until|through|till|resum\w*)[^.\n]{0,40}/.exec(t)?.[0] ?? t;
  const named = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/.exec(near) ??
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+(\d{4}))?/.exec(near);
  let month: number | null = null;
  let day: number | null = null;
  let year: number | null = null;
  if (named) {
    if (/^\d/.test(named[1]!)) {
      day = Number(named[1]);
      month = MONTHS.indexOf(named[2]!.slice(0, 3));
    } else {
      month = MONTHS.indexOf(named[1]!.slice(0, 3));
      day = Number(named[2]);
    }
    year = named[3] ? Number(named[3]) : null;
  } else {
    const numeric = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(near);
    if (numeric) {
      month = Number(numeric[1]) - 1;
      day = Number(numeric[2]);
      year = numeric[3] ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]) : null;
    }
  }
  if (month === null || month < 0 || month > 11 || !day || day > 31) return null;
  let d = new Date(Date.UTC(year ?? now.getUTCFullYear(), month, day, 12));
  if (!year && d.getTime() < now.getTime() - 86_400_000) {
    d = new Date(Date.UTC(now.getUTCFullYear() + 1, month, day, 12));
  }
  // Nobody is away for more than a year.
  if (d.getTime() - now.getTime() > 366 * 86_400_000) return null;
  return d;
}

export interface AutoReply {
  outOfOffice: boolean;
  /** Any automatic message (out-of-office, auto-acknowledgement, list mail). */
  automatic: boolean;
  backOn: Date | null;
}

export function autoReplyOf(m: Pick<InboundMessage, "subject" | "text" | "headers">, now: Date = new Date()): AutoReply {
  const h = m.headers;
  const auto = (h["auto-submitted"] ?? "no").toLowerCase();
  const headerAuto =
    (auto !== "no" && auto !== "") ||
    "x-autoreply" in h ||
    "x-autorespond" in h ||
    /^(auto_reply|bulk|junk|list)$/i.test(h["precedence"] ?? "") ||
    /^(oof|autoreply)$/i.test(h["x-auto-response-suppress"] ?? "");
  const subjectOoo = OOO_SUBJECT.test(m.subject);
  const bodyOoo = OOO_BODY.test(m.text.slice(0, 2000));
  const outOfOffice = subjectOoo || (headerAuto && bodyOoo);
  return {
    outOfOffice,
    automatic: headerAuto || subjectOoo,
    backOn: outOfOffice ? returnDate(`${m.subject}\n${m.text.slice(0, 2000)}`, now) : null,
  };
}

// ---- Bounces -------------------------------------------------------------------------

export interface Bounce {
  bounced: boolean;
  /** The address that failed, when the report names it. */
  recipient: string | null;
  /** 5xx: the address doesn't exist (stop for good); 4xx: try later. */
  permanent: boolean;
}

export function bounceOf(m: Pick<InboundMessage, "from" | "subject" | "text" | "headers">): Bounce {
  const from = bareAddress(m.from) ?? "";
  const ct = (m.headers["content-type"] ?? "").toLowerCase();
  const daemon = /^(mailer-daemon|postmaster|mail-daemon)@/i.test(from);
  const report = ct.includes("report-type=delivery-status") || ct.includes("multipart/report");
  const subject = /\b(undeliver(able|ed)|delivery (status notification|has failed|failure)|returned mail|failure notice|mail delivery (failed|subsystem)|could not be delivered)\b/i.test(
    m.subject,
  );
  const bounced = report || (daemon && subject) || (daemon && /final-recipient/i.test(m.text));
  if (!bounced) return { bounced: false, recipient: null, permanent: false };
  const finalRecipient = /final-recipient:\s*(?:rfc822;)?\s*<?([^\s<>;]+@[^\s<>;]+)>?/i.exec(m.text)?.[1];
  const named =
    finalRecipient ??
    /(?:to|recipient|address)[^@\n]{0,40}?<?([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})>?[^\n]{0,60}(?:fail|not|rejected|unknown|exist)/i.exec(
      m.text,
    )?.[1] ??
    null;
  const status = /status:\s*([245])\.\d+\.\d+/i.exec(m.text)?.[1] ?? /\b([45])\d\d\b[ -]\d\.\d\.\d/.exec(m.text)?.[1] ?? "5";
  return { bounced: true, recipient: named ? named.toLowerCase() : null, permanent: status !== "4" };
}

// ---- The reply itself ---------------------------------------------------------------

/** The new part of a reply: the quoted thread, "On ... wrote:" and forwarded headers dropped. */
export function newText(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*>/.test(line)) break;
    if (/^On .{4,200}wrote:\s*$/.test(line) || /^On .{4,200}$/.test(line) && /wrote:\s*$/.test(lines[i + 1] ?? "")) break;
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(line)) break;
    if (/^-{5,}\s*Forwarded message/i.test(line)) break;
    if (/^From: .+/.test(line) && /^(Sent|Date): /.test(lines[i + 1] ?? "")) break;
    out.push(line);
  }
  return out.join("\n").trim();
}

export interface Signature {
  name: string | null;
  title: string | null;
  company: string | null;
  phone: string | null;
}

const PHONE = /(\+?\d[\d\s().-]{7,}\d)/;
const TITLE_WORDS = /\b(director|manager|coordinator|president|vice|chair|founder|ceo|cto|coo|cfo|head|lead|officer|partner|associate|assistant|specialist|professor|dean|advisor|consultant|engineer|organizer|treasurer|secretary|editor|producer)\b/i;

/**
 * Who signed a message: the few short lines after the sign-off ("Best,",
 * "Thanks,", "--") read as name, title, company and phone. Best effort,
 * so it only ever feeds a suggestion a person accepts.
 */
export function signatureOf(text: string, fallbackName: string | null = null): Signature {
  const body = newText(text);
  const lines = body.split("\n").map((l) => l.trim());
  let start = -1;
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 15); i--) {
    if (/^(--|—|best|thanks|thank you|cheers|regards|kind regards|best regards|warmly|sincerely|all the best)[,!. ]*$/i.test(lines[i]!)) {
      start = i + 1;
      break;
    }
  }
  const block = (start >= 0 ? lines.slice(start) : lines.slice(-5)).filter((l) => l && l.length <= 80).slice(0, 6);
  const sig: Signature = { name: null, title: null, company: null, phone: null };
  for (const l of block) {
    const phone = PHONE.exec(l);
    if (phone && !sig.phone && phone[1]!.replace(/\D/g, "").length >= 9) {
      sig.phone = phone[1]!.trim();
      continue;
    }
    if (/@|https?:\/\/|www\./i.test(l)) continue;
    if (!sig.name && start >= 0 && /^[A-Z][a-zA-Z'.-]+(\s+[A-Z][a-zA-Z'.-]+){0,3}$/.test(l)) {
      sig.name = l;
      continue;
    }
    if (!sig.title && TITLE_WORDS.test(l)) {
      const [title, company] = l.split(/\s*(?:,|\||\bat\b|@)\s*/);
      sig.title = title?.trim() || null;
      if (company?.trim()) sig.company = company.trim();
      continue;
    }
    if (sig.title && !sig.company && /^[A-Z]/.test(l)) sig.company = l;
  }
  if (!sig.name) sig.name = fallbackName;
  return sig;
}

/** Free mail domains never make a company. */
export const FREE_MAIL = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "msn.com",
]);

/** Senders that are never a person (no-reply, notifications, newsletters). */
export function isRobot(address: string): boolean {
  return /^(no-?reply|do-?not-?reply|notifications?|mailer-daemon|postmaster|bounces?|news(letter)?|updates?|info|support|hello|team)([+._-]|@)/i.test(
    address,
  );
}
