/**
 * Duplicate finding (docs/features/crm.md, module 1): fuzzy matching on
 * name, email, domain and phone. Pure: the server loads the candidates,
 * this scores them, and anything over the bar becomes a MERGE suggestion in
 * the review list. Nothing merges on its own.
 *
 * Scoring (0-100):
 *   same email address                     100 (certain)
 *   same phone number (last 10 digits)      +45
 *   names alike (Jaro-Winkler on a normal form, nicknames folded)
 *                                          up to +45
 *   same work email domain, or the same company
 *                                           +15
 *   one name's initial matches the other    +10 (A. Lovelace / Ada Lovelace)
 * A pair is suggested at SUGGEST_AT and above. A same-domain pair needs the
 * names to agree too: colleagues share a domain.
 */

export const SUGGEST_AT = 70;

/** Addresses anyone can have: they say nothing about a company. */
export const FREE_MAIL = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "gmx.de",
  "mail.com",
  "zoho.com",
  "yandex.com",
  "fastmail.com",
  "hey.com",
  "qq.com",
  "163.com",
]);

/** "  Ada@Example.COM " -> "ada@example.com"; null when it isn't an address. */
export function normalizeEmail(input: string | null | undefined): string | null {
  const s = (input ?? "").trim().toLowerCase().replace(/^mailto:/, "");
  if (s.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return null;
  return s;
}

/** "https://www.Example.com/about" or "ada@example.com" -> "example.com". */
export function normalizeDomain(input: string | null | undefined): string | null {
  let s = (input ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s.includes("@")) s = s.split("@").pop() ?? "";
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^www\./, "");
  s = s.split(/[/?#:]/)[0] ?? "";
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s)) return null;
  return s;
}

/** The domain an address says something about (free mail says nothing). */
export function workDomain(email: string | null | undefined): string | null {
  const d = normalizeDomain(email);
  return d && !FREE_MAIL.has(d) ? d : null;
}

/** The last 10 digits, so "+1 (617) 555-0101" and "617.555.0101" match. */
export function normalizePhone(input: string | null | undefined): string | null {
  const digits = (input ?? "").replace(/\D/g, "");
  if (digits.length < 7) return null;
  return digits.slice(-10);
}

const NICKNAMES: Record<string, string> = {
  alex: "alexander",
  al: "albert",
  andy: "andrew",
  drew: "andrew",
  ben: "benjamin",
  bill: "william",
  billy: "william",
  will: "william",
  liam: "william",
  bob: "robert",
  bobby: "robert",
  rob: "robert",
  robbie: "robert",
  chris: "christopher",
  dan: "daniel",
  danny: "daniel",
  dave: "david",
  ed: "edward",
  eddie: "edward",
  jim: "james",
  jimmy: "james",
  jamie: "james",
  joe: "joseph",
  joey: "joseph",
  jon: "jonathan",
  kate: "katherine",
  katie: "katherine",
  kathy: "katherine",
  cathy: "catherine",
  liz: "elizabeth",
  beth: "elizabeth",
  lizzie: "elizabeth",
  maggie: "margaret",
  meg: "margaret",
  peggy: "margaret",
  matt: "matthew",
  mike: "michael",
  mick: "michael",
  nick: "nicholas",
  pat: "patricia",
  patty: "patricia",
  rick: "richard",
  dick: "richard",
  rich: "richard",
  sam: "samuel",
  steve: "steven",
  stephen: "steven",
  sue: "susan",
  suzy: "susan",
  tom: "thomas",
  tommy: "thomas",
  tony: "anthony",
  vicky: "victoria",
  jen: "jennifer",
  jenny: "jennifer",
  abby: "abigail",
  becky: "rebecca",
  nate: "nathan",
  zach: "zachary",
  josh: "joshua",
  greg: "gregory",
  jeff: "jeffrey",
  ken: "kenneth",
  larry: "lawrence",
  ron: "ronald",
  tim: "timothy",
};

/** "Dr. Bob  O'Brien Jr." -> "robert obrien": lowercase, no accents, titles or suffixes, nicknames folded. */
export function normalizeName(input: string | null | undefined): string {
  const words = (input ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter(Boolean)
    .filter((w) => !["dr", "mr", "mrs", "ms", "mx", "prof", "jr", "sr", "ii", "iii", "phd", "md"].includes(w));
  return words.map((w) => NICKNAMES[w] ?? w).join(" ");
}

/** Jaro-Winkler similarity, 0..1. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return a.length === 0 ? 0 : 1;
  if (!a || !b) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aHit = new Array<boolean>(a.length).fill(false);
  const bHit = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - range);
    const hi = Math.min(b.length - 1, i + range);
    for (let j = lo; j <= hi; j++) {
      if (bHit[j] || a[i] !== b[j]) continue;
      aHit[i] = true;
      bHit[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aHit[i]) continue;
    while (!bHit[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const m = matches;
  const jaro = (m / a.length + m / b.length + (m - t / 2) / m) / 3;
  let prefix = 0;
  while (prefix < 4 && prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** How alike two names are, 0..1, word order aside ("Lovelace Ada" = "Ada Lovelace"). */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const sorted = (s: string) => s.split(" ").sort().join(" ");
  return Math.max(jaroWinkler(na, nb), jaroWinkler(sorted(na), sorted(nb)));
}

/** "A. Lovelace" and "Ada Lovelace": same last name, and one first name is the other's initial. */
export function initialMatch(a: string, b: string): boolean {
  const wa = normalizeName(a).split(" ");
  const wb = normalizeName(b).split(" ");
  if (wa.length < 2 || wb.length < 2) return false;
  if (wa[wa.length - 1] !== wb[wb.length - 1]) return false;
  const fa = wa[0]!;
  const fb = wb[0]!;
  return (fa.length === 1 && fb.startsWith(fa)) || (fb.length === 1 && fa.startsWith(fb));
}

export interface DedupePerson {
  id: string;
  name: string;
  emails: readonly string[];
  phone?: string | null;
  companyId?: string | null;
}

export interface MatchScore {
  score: number;
  reasons: string[];
}

/** How likely two people are the same, with the reasons a reviewer sees. */
export function scorePeople(a: DedupePerson, b: DedupePerson): MatchScore {
  const reasons: string[] = [];
  const ea = new Set(a.emails.map((e) => normalizeEmail(e)).filter((e): e is string => Boolean(e)));
  const shared = b.emails.map((e) => normalizeEmail(e)).find((e) => e && ea.has(e));
  if (shared) return { score: 100, reasons: [`Same email (${shared})`] };

  let score = 0;
  const sim = nameSimilarity(a.name, b.name);
  if (sim >= 0.999) {
    score += 45;
    reasons.push("Same name");
  } else if (sim >= 0.9) {
    score += Math.round(45 * ((sim - 0.8) / 0.2));
    reasons.push("Similar names");
  } else if (initialMatch(a.name, b.name)) {
    score += 30;
    reasons.push("Same last name and initial");
  }
  const pa = normalizePhone(a.phone);
  if (pa && pa === normalizePhone(b.phone)) {
    score += 45;
    reasons.push("Same phone");
  }
  const da = new Set(a.emails.map(workDomain).filter((d): d is string => Boolean(d)));
  const sameDomain = b.emails.map(workDomain).some((d) => d && da.has(d));
  const sameCompany = Boolean(a.companyId && a.companyId === b.companyId);
  if ((sameDomain || sameCompany) && sim >= 0.85) {
    score += 15;
    reasons.push(sameCompany ? "Same company" : "Same email domain");
  }
  if (initialMatch(a.name, b.name) && sim >= 0.9) score += 10;
  return { score: Math.min(99, score), reasons };
}

export interface DedupeCompany {
  id: string;
  name: string;
  domain?: string | null;
  website?: string | null;
}

const COMPANY_SUFFIX =
  /\b(inc|incorporated|llc|ltd|limited|co|corp|corporation|company|plc|gmbh|sa|ag|foundation|the)\b/g;

/** "The Harbor Light Coffee Co., Inc." -> "harbor light coffee". */
export function normalizeCompanyName(input: string | null | undefined): string {
  return normalizeName(input).replace(COMPANY_SUFFIX, " ").replace(/\s+/g, " ").trim();
}

export function scoreCompanies(a: DedupeCompany, b: DedupeCompany): MatchScore {
  const da = normalizeDomain(a.domain) ?? normalizeDomain(a.website);
  const db = normalizeDomain(b.domain) ?? normalizeDomain(b.website);
  if (da && db && da === db) return { score: 100, reasons: [`Same domain (${da})`] };
  const na = normalizeCompanyName(a.name);
  const nb = normalizeCompanyName(b.name);
  if (!na || !nb) return { score: 0, reasons: [] };
  if (na === nb) return { score: 90, reasons: ["Same name"] };
  const sim = jaroWinkler(na, nb);
  if (sim >= 0.93) return { score: Math.round(60 + (sim - 0.93) * 400), reasons: ["Similar names"] };
  return { score: 0, reasons: [] };
}

/**
 * Blocking: the keys two records must share to be compared at all, so a
 * scan is near-linear instead of every pair. People: each email, the phone,
 * the normalized last name with first initial, the first 4 letters of the
 * normalized name. Companies: the domain and the first 5 letters of the name.
 */
export function personBlocks(p: DedupePerson): string[] {
  const keys = new Set<string>();
  for (const e of p.emails) {
    const n = normalizeEmail(e);
    if (n) keys.add(`e:${n}`);
  }
  const phone = normalizePhone(p.phone);
  if (phone) keys.add(`p:${phone}`);
  const words = normalizeName(p.name).split(" ").filter(Boolean);
  if (words.length >= 2) keys.add(`n:${words[words.length - 1]}:${words[0]![0]}`);
  if (words.length >= 1) keys.add(`s:${words.join("").slice(0, 4)}`);
  return [...keys];
}

export function companyBlocks(c: DedupeCompany): string[] {
  const keys = new Set<string>();
  const d = normalizeDomain(c.domain) ?? normalizeDomain(c.website);
  if (d) keys.add(`d:${d}`);
  const n = normalizeCompanyName(c.name).replace(/\s/g, "");
  if (n) keys.add(`n:${n.slice(0, 5)}`);
  return [...keys];
}

export interface Pair<T> {
  a: T;
  b: T;
  score: number;
  reasons: string[];
}

/** Every pair worth reviewing, best first (each pair once, the older record as `a`). */
export function findPairs<T extends { id: string }>(
  records: readonly T[],
  blocks: (r: T) => string[],
  score: (a: T, b: T) => MatchScore,
  options: { min?: number; maxBlock?: number } = {},
): Pair<T>[] {
  const min = options.min ?? SUGGEST_AT;
  const maxBlock = options.maxBlock ?? 50;
  const byKey = new Map<string, T[]>();
  for (const r of records) {
    for (const k of blocks(r)) {
      const list = byKey.get(k);
      if (list) list.push(r);
      else byKey.set(k, [r]);
    }
  }
  const seen = new Set<string>();
  const out: Pair<T>[] = [];
  for (const list of byKey.values()) {
    // A block everyone shares ("s:john") says nothing; skip it rather than go quadratic.
    if (list.length < 2 || list.length > maxBlock) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        if (a.id === b.id) continue;
        const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const s = score(a, b);
        if (s.score >= min) out.push({ a, b, score: s.score, reasons: s.reasons });
      }
    }
  }
  return out.sort((x, y) => y.score - x.score);
}
