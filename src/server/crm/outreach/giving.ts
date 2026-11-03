import type { TxClient } from "@/server/db/context";

/**
 * Donations, recurring gifts and volunteer hours on a person's page
 * (docs/features/crm.md, Build order 2), read from what Finance and Events
 * already hold; no new Finance tables:
 *
 * - gifts: income in Finance whose payer (counterparty) is this person or
 *   their company, plus won items in giving pipelines (donors, grants) they
 *   are on; Finance rows only show to finance roles, as in Finance;
 * - recurring: the same payer giving at least three times at about the
 *   same interval (monthly, quarterly, yearly);
 * - volunteer hours: the length of the events they checked in to.
 */

export interface Giving {
  gifts: { at: Date; amountCents: number; what: string; source: "finance" | "pipeline" }[];
  totalCents: number;
  lastGiftAt: Date | null;
  recurring: { every: string; amountCents: number } | null;
  volunteer: { events: number; hours: number; lastAt: Date | null };
}

const GIVING_TEMPLATES = ["donors", "grants", "sponsors"];

function cadenceOf(dates: Date[]): string | null {
  if (dates.length < 3) return null;
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  const gaps = sorted.slice(1).map((d, i) => (d.getTime() - sorted[i]!.getTime()) / 86_400_000);
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  if (gaps.some((g) => Math.abs(g - avg) > Math.max(10, avg * 0.35))) return null;
  if (avg >= 25 && avg <= 35) return "month";
  if (avg >= 80 && avg <= 100) return "quarter";
  if (avg >= 340 && avg <= 390) return "year";
  if (avg >= 6 && avg <= 8) return "week";
  return null;
}

export async function givingFor(
  db: TxClient,
  organizationId: string,
  person: { id: string; name: string; contactId: string | null; company?: { name: string } | null },
): Promise<Giving> {
  const names = [person.name, person.company?.name].filter((n): n is string => Boolean(n && n.trim().length > 2));
  const income = names.length
    ? await db.transaction
        .findMany({
          where: {
            organizationId,
            direction: "IN",
            voidedAt: null,
            kind: { in: ["OTHER_INCOME", "SPONSORSHIP"] },
            OR: names.map((n) => ({ counterparty: { equals: n, mode: "insensitive" as const } })),
          },
          orderBy: { occurredAt: "desc" },
          take: 200,
          select: { occurredAt: true, amountCents: true, description: true },
        })
        .catch(() => [])
    : [];
  const won = await db.crmDealPerson.findMany({
    where: {
      organizationId,
      personId: person.id,
      deal: { deletedAt: null, amountCents: { not: null }, stage: { kind: "WON" }, pipeline: { template: { in: GIVING_TEMPLATES } } },
    },
    select: { deal: { select: { title: true, amountCents: true, closedAt: true, updatedAt: true, sponsorshipId: true } } },
    take: 100,
  });
  const gifts: Giving["gifts"] = [
    ...income.map((t) => ({ at: t.occurredAt, amountCents: t.amountCents, what: t.description, source: "finance" as const })),
    // A sponsorship already in Finance isn't counted twice.
    ...won
      .filter((w) => !w.deal.sponsorshipId || income.length === 0)
      .map((w) => ({ at: w.deal.closedAt ?? w.deal.updatedAt, amountCents: w.deal.amountCents!, what: w.deal.title, source: "pipeline" as const })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
  const every = cadenceOf(income.map((t) => t.occurredAt));
  const recurring = every
    ? { every, amountCents: Math.round(income.slice(0, 3).reduce((n, t) => n + t.amountCents, 0) / Math.min(3, income.length)) }
    : null;
  const checkIns = person.contactId
    ? await db.attendance.findMany({
        where: { organizationId, contactId: person.contactId, suppressedAt: null },
        orderBy: { checkedInAt: "desc" },
        take: 500,
        select: { checkedInAt: true, event: { select: { startsAt: true, endsAt: true, allDay: true } } },
      })
    : [];
  const hours = checkIns.reduce((h, c) => {
    if (c.event.allDay) return h + 4;
    const len = (c.event.endsAt.getTime() - c.event.startsAt.getTime()) / 3_600_000;
    return h + Math.min(Math.max(len, 0), 12);
  }, 0);
  return {
    gifts: gifts.slice(0, 20),
    totalCents: gifts.reduce((n, g) => n + g.amountCents, 0),
    lastGiftAt: gifts[0]?.at ?? null,
    recurring,
    volunteer: { events: checkIns.length, hours: Math.round(hours * 10) / 10, lastAt: checkIns[0]?.checkedInAt ?? null },
  };
}
