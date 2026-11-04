/**
 * Words written for people from real records: the handover brief a new
 * owner reads for each contact (docs/features/crm.md, "What makes ours
 * better" 5), and the recap a partner or client sees on their guest page
 * (4). Pure.
 */

export interface BriefInput {
  name: string;
  company: string | null;
  title: string | null;
  previousOwner: string | null;
  lastContactedAt: Date | null;
  firstContactAt: Date | null;
  touches: number;
  /** The newest few timeline rows. */
  recent: { kind: string; subject: string | null; at: Date }[];
  /** Open items with their stage and next step. */
  open: { title: string; stage: string; nextStep: string | null; amountCents: number | null }[];
  /** What we still owe them. */
  promises: { title: string; dueOn: Date | null }[];
  /** Money: received and pledged, in cents. */
  receivedCents: number;
  pledgedCents: number;
  cadenceDays: number | null;
  doNotContact: boolean;
}

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: cents % 100 ? 2 : 0 }).format(
    cents / 100,
  );
}

function day(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** The brief as short paragraphs, in the order a new owner needs them. */
export function handoverBrief(b: BriefInput): string[] {
  const out: string[] = [];
  const who = [b.title, b.company].filter(Boolean).join(" at ");
  out.push(
    `${b.name}${who ? `, ${who}` : ""}.` +
      (b.previousOwner ? ` ${b.previousOwner} looked after them.` : "") +
      (b.firstContactAt ? ` In touch since ${day(b.firstContactAt)}, ${b.touches} times in all.` : ""),
  );
  if (b.doNotContact) out.push("They asked not to be contacted. Don't reach out.");
  out.push(
    b.lastContactedAt
      ? `Last in touch ${day(b.lastContactedAt)}.` + (b.cadenceDays ? ` Keep in touch every ${b.cadenceDays} days.` : "")
      : "Nobody has been in touch yet.",
  );
  if (b.recent.length) {
    out.push(
      "Lately: " +
        b.recent
          .slice(0, 5)
          .map((r) => `${r.subject ?? r.kind.toLowerCase()} (${day(r.at)})`)
          .join("; ") +
        ".",
    );
  }
  if (b.open.length) {
    out.push(
      "Open: " +
        b.open
          .map(
            (o) =>
              `${o.title}, ${o.stage}` +
              (o.amountCents ? `, ${money(o.amountCents)}` : "") +
              (o.nextStep ? `, next: ${o.nextStep}` : ", no next step"),
          )
          .join("; ") +
        ".",
    );
  }
  if (b.promises.length) {
    out.push(
      "We still owe them: " +
        b.promises.map((p) => p.title + (p.dueOn ? ` by ${day(p.dueOn)}` : "")).join("; ") +
        ".",
    );
  }
  if (b.receivedCents || b.pledgedCents) {
    out.push(
      [b.receivedCents ? `${money(b.receivedCents)} received` : null, b.pledgedCents ? `${money(b.pledgedCents)} pledged` : null]
        .filter(Boolean)
        .join(", ") + ".",
    );
  }
  return out;
}
