import { normalizeDomain, normalizeEmail } from "@/lib/crm/dedupe";
import { normalizePhone as formatPhone } from "@/lib/rsvp/format";
import { normalizeUrl } from "@/lib/crm/validate";

import { CrmError } from "./access";

/**
 * Input cleaning shared by people, companies and items: trimmed text, empty
 * as null, addresses lowercased, links with their https, dates as Dates.
 * Throws CrmError with the field's name when a value can't be read.
 */

export function text(v: unknown, max = 300): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string" && typeof v !== "number") throw new CrmError("Enter text.");
  const s = String(v).replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (s.length > max) throw new CrmError(`Keep it under ${max.toLocaleString()} characters.`);
  return s;
}

export function longText(v: unknown, max = 5000): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") throw new CrmError("Enter text.");
  const s = v.trim();
  if (!s) return null;
  if (s.length > max) throw new CrmError(`Keep it under ${max.toLocaleString()} characters.`);
  return s;
}

export function email(v: unknown, label = "Email"): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || (typeof v === "string" && !v.trim())) return null;
  const e = normalizeEmail(typeof v === "string" ? v : "");
  if (!e) throw new CrmError(`${label}: that address doesn't look right.`, ["primaryEmail"]);
  return e;
}

export function url(v: unknown, label = "Website"): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || (typeof v === "string" && !v.trim())) return null;
  const u = normalizeUrl(typeof v === "string" ? v : "");
  if (!u) throw new CrmError(`${label}: write a link like example.com.`);
  return u.slice(0, 2000);
}

export function domain(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || (typeof v === "string" && !v.trim())) return null;
  const d = normalizeDomain(typeof v === "string" ? v : "");
  if (!d) throw new CrmError("Domain: write one like example.com.", ["domain"]);
  return d;
}

export function phone(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || (typeof v === "string" && !v.trim())) return null;
  const s = typeof v === "string" ? v : String(v);
  // Keep what was written when it isn't a number we can format (an extension, a note).
  return (formatPhone(s) ?? s.trim()).slice(0, 60);
}

/** A day ("2026-03-14") or an instant, as a Date at noon UTC for days. */
export function date(v: unknown, label = "Date"): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) throw new CrmError(`${label}: pick a real date.`);
    return v;
  }
  if (typeof v === "string") {
    const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
    const d = day ? new Date(Date.UTC(+day[1]!, +day[2]! - 1, +day[3]!, 12)) : new Date(v);
    if (Number.isNaN(d.getTime())) throw new CrmError(`${label}: pick a real date.`);
    return d;
  }
  throw new CrmError(`${label}: pick a real date.`);
}

export function int(v: unknown, label: string, min: number, max: number): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new CrmError(`${label}: pick a whole number from ${min} to ${max}.`);
  }
  return n;
}

/** "$1,500.50" or 1500.5 (dollars) as cents. */
export function cents(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0 || n > 1e11) throw new CrmError("Amount: enter zero or more.", ["amount"]);
  return Math.round(n * 100);
}

export function bool(v: unknown): boolean | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return /^(true|yes|y|1|x)$/i.test(v.trim());
  return Boolean(v);
}

export function id(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (typeof v !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(v)) throw new CrmError("That link isn't valid.");
  return v;
}
