/**
 * Who does what: splitting a campaign's list among members, and routing a
 * new person to an owner (round-robin, or the first rule that matches).
 * Pure.
 */

/**
 * Splits people among members as evenly as possible, counting what each
 * already has. Someone with a relationship owner who is one of the
 * members goes to that owner first (they know them).
 */
export function splitAmong(
  people: readonly { id: string; ownerId?: string | null }[],
  memberIds: readonly string[],
  already: ReadonlyMap<string, number> = new Map(),
): Map<string, string> {
  const out = new Map<string, string>();
  if (memberIds.length === 0) return out;
  const load = new Map(memberIds.map((m) => [m, already.get(m) ?? 0]));
  const fair = Math.ceil((people.length + [...load.values()].reduce((a, b) => a + b, 0)) / memberIds.length);
  const rest: string[] = [];
  for (const p of people) {
    if (p.ownerId && load.has(p.ownerId) && load.get(p.ownerId)! < fair) {
      out.set(p.id, p.ownerId);
      load.set(p.ownerId, load.get(p.ownerId)! + 1);
    } else rest.push(p.id);
  }
  for (const id of rest) {
    let best = memberIds[0]!;
    for (const m of memberIds) if (load.get(m)! < load.get(best)!) best = m;
    out.set(id, best);
    load.set(best, load.get(best)! + 1);
  }
  return out;
}

// ---- Owner routing -----------------------------------------------------------------

/** "When {field} {is|contains} {value}, give them to {ownerId}." */
export interface RoutingRule {
  field: "relationship" | "source" | "company" | "location" | "title" | "email";
  op: "is" | "contains";
  value: string;
  ownerId: string;
}

export interface Routing {
  /** off: whoever made them; round-robin among `pool`; rules, then round-robin. */
  mode: "off" | "round-robin" | "rules";
  pool: string[];
  rules: RoutingRule[];
}

export const NO_ROUTING: Routing = { mode: "off", pool: [], rules: [] };

const FIELDS = new Set<RoutingRule["field"]>(["relationship", "source", "company", "location", "title", "email"]);

export function readRouting(raw: unknown): Routing {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Routing>;
  const mode = r.mode === "round-robin" || r.mode === "rules" ? r.mode : "off";
  const pool = Array.isArray(r.pool) ? r.pool.filter((x): x is string => typeof x === "string").slice(0, 100) : [];
  const rules = Array.isArray(r.rules)
    ? r.rules
        .filter(
          (x): x is RoutingRule =>
            Boolean(x) &&
            typeof x === "object" &&
            FIELDS.has((x as RoutingRule).field) &&
            ((x as RoutingRule).op === "is" || (x as RoutingRule).op === "contains") &&
            typeof (x as RoutingRule).value === "string" &&
            typeof (x as RoutingRule).ownerId === "string",
        )
        .slice(0, 50)
    : [];
  return { mode, pool, rules };
}

export interface RoutedPerson {
  relationship?: string | null;
  source?: string | null;
  company?: string | null;
  location?: string | null;
  title?: string | null;
  email?: string | null;
}

/**
 * The owner a new person gets: the first rule that matches (rules mode),
 * else whoever in the pool has had the fewest lately; null when routing is
 * off or nobody can take them.
 */
export function routeOwner(
  routing: Routing,
  person: RoutedPerson,
  members: ReadonlySet<string>,
  recent: ReadonlyMap<string, number>,
): { ownerId: string; why: string } | null {
  if (routing.mode === "off") return null;
  if (routing.mode === "rules") {
    for (const rule of routing.rules) {
      if (!members.has(rule.ownerId)) continue;
      const have = String(person[rule.field] ?? "").toLowerCase().trim();
      const want = rule.value.toLowerCase().trim();
      if (!want) continue;
      if (rule.op === "is" ? have === want : have.includes(want)) {
        return { ownerId: rule.ownerId, why: `${rule.field} ${rule.op} ${rule.value}` };
      }
    }
  }
  const pool = routing.pool.filter((id) => members.has(id));
  if (pool.length === 0) return null;
  let best = pool[0]!;
  for (const id of pool) if ((recent.get(id) ?? 0) < (recent.get(best) ?? 0)) best = id;
  return { ownerId: best, why: "round-robin" };
}

// ---- Campaign numbers -----------------------------------------------------------------

export type TargetStatus = "TODO" | "CONTACTED" | "REPLIED" | "BOOKED" | "CONVERTED" | "SKIPPED";

/** Each status counts toward the ones before it: a reply was also contacted. */
const ORDER: TargetStatus[] = ["TODO", "CONTACTED", "REPLIED", "BOOKED", "CONVERTED"];

export interface CampaignNumbers {
  total: number;
  contacted: number;
  replied: number;
  booked: number;
  converted: number;
  skipped: number;
  todo: number;
}

export function campaignNumbers(statuses: readonly TargetStatus[]): CampaignNumbers {
  const n: CampaignNumbers = { total: statuses.length, contacted: 0, replied: 0, booked: 0, converted: 0, skipped: 0, todo: 0 };
  for (const s of statuses) {
    if (s === "SKIPPED") {
      n.skipped++;
      continue;
    }
    const at = ORDER.indexOf(s);
    if (at === 0) n.todo++;
    if (at >= 1) n.contacted++;
    if (at >= 2) n.replied++;
    if (at >= 3) n.booked++;
    if (at >= 4) n.converted++;
  }
  return n;
}

/** A status only moves forward (a reply after a booking stays booked). */
export function advance(current: TargetStatus, next: TargetStatus): TargetStatus {
  if (current === "SKIPPED" || next === "SKIPPED") return next === "SKIPPED" ? "SKIPPED" : current;
  return ORDER.indexOf(next) > ORDER.indexOf(current) ? next : current;
}
