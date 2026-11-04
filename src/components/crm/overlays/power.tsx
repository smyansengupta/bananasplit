import { todayForShell, todayScope } from "@/app/app/[orgSlug]/crm/today-data";
import { PowerCard, type PowerPerson } from "@/components/crm/cards/power-card";
import { withOrgTx } from "@/server/db/context";

import type { OverlayProps } from "./crm-overlays";

const MAX = 15;

/**
 * Power hour (?open=power): Today's people one at a time, replies first,
 * each with why now, their latest two touches and the draft waiting for
 * them (or an empty one to write). The rows are Today's own
 * (todayForShell: read once when the card opens over Today), and the rest
 * is three reads for everyone in it.
 */
export async function PowerOverlay({ shell, searchParams }: OverlayProps<"power">) {
  const orgId = shell.org.id;
  const { rows } = await todayForShell(shell, todayScope(searchParams.who));
  // People to reach, then drafts waiting for an OK (a plan's later step,
  // an automation's email), each person once.
  const seen = new Set<string>();
  const queue = [...rows.filter((r) => r.group !== "approve"), ...rows.filter((r) => r.group === "approve")]
    .filter((r) => r.person && !seen.has(r.person.id) && seen.add(r.person.id))
    .slice(0, MAX);
  const ids = queue.map((r) => r.person!.id);
  const people = await withOrgTx(orgId, async ({ db }) => {
    if (ids.length === 0) return [];
    const details = await db.crmPerson.findMany({
      where: { organizationId: orgId, id: { in: ids } },
      select: { id: true, title: true, company: { select: { name: true } } },
    });
    const byId = new Map(details.map((d) => [d.id, d]));
    const drafts = await db.crmEmailMessage.findMany({
      where: {
        organizationId: orgId,
        status: "DRAFT",
        mailboxUserId: shell.user.id,
        personId: { in: ids },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, personId: true, subject: true, bodyText: true },
    });
    // Each person's latest two touches (not the CRM's own system lines).
    const touches = await db.$queryRaw<
      { personId: string; subject: string | null; kind: string; occurredAt: Date }[]
    >`
      SELECT x."personId", x.subject, x.kind, x."occurredAt"
      FROM (
        SELECT t."targetId" AS "personId", a.subject, a.kind::text AS kind, a."occurredAt",
          ROW_NUMBER() OVER (PARTITION BY t."targetId" ORDER BY a."occurredAt" DESC) AS n
        FROM "CrmActivityTarget" t
        JOIN "CrmActivity" a ON a.id = t."activityId"
        WHERE t."organizationId" = ${orgId} AND t."targetKind" = 'person'
          AND t."targetId" = ANY(${ids}::text[])
          AND a."deletedAt" IS NULL AND a.kind <> 'SYSTEM'
      ) x
      WHERE x.n <= 2
      ORDER BY x."occurredAt" DESC`;
    const recentOf = new Map<string, typeof touches>();
    for (const t of touches) recentOf.set(t.personId, [...(recentOf.get(t.personId) ?? []), t]);

    return queue.map((r): PowerPerson => {
      const id = r.person!.id;
      // The draft this row is about (a waiting step's), else their latest.
      const own = r.actions.find((a) => a.type === "send-draft");
      const draft =
        (own?.type === "send-draft" ? drafts.find((d) => d.id === own.draftId) : undefined) ??
        drafts.find((d) => d.personId === id);
      const d = byId.get(id);
      return {
        id,
        name: r.name,
        sub: [r.tag, d?.title, d?.company?.name].filter(Boolean).join(", ") || null,
        whyShort: r.why,
        why: r.text,
        recent: (recentOf.get(id) ?? [])
          .map(
            (a) =>
              `${a.occurredAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${(a.subject ?? a.kind.toLowerCase()).replace(/\.$/, "")}`,
          )
          .join(". "),
        email: r.person!.email,
        phone: r.person!.phone,
        draft: draft ? { id: draft.id, subject: draft.subject ?? "", body: draft.bodyText ?? "" } : null,
        reply: r.person!.reply,
      };
    });
  });
  return <PowerCard orgId={orgId} people={people} />;
}
