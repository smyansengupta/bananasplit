import { PowerCard, type PowerPerson } from "@/components/crm/cards/power-card";
import { todayRows } from "@/server/crm/today";
import { withOrgTx } from "@/server/db/context";

import type { OverlayProps } from "./crm-overlays";

const MAX = 15;

/**
 * Power hour (?open=power): Today's people one at a time, replies first,
 * each with why now, their latest two touches and the draft waiting for
 * them (or an empty one to write).
 */
export async function PowerOverlay({ shell, searchParams }: OverlayProps<"power">) {
  const orgId = shell.org.id;
  const everyone = searchParams.who === "all";
  const relationships = new Map(
    (shell.access.settings?.relationshipTypes ?? []).map((t) => [t.id, t.label]),
  );
  const people = await withOrgTx(orgId, async ({ db }) => {
    const { rows } = await todayRows(db, orgId, shell.user.id, shell.roles, {
      everyone,
      relationships,
    });
    // People to reach, then drafts waiting for an OK (a plan's later step,
    // an automation's email), each person once.
    const seen = new Set<string>();
    const queue = [...rows.filter((r) => r.group !== "approve"), ...rows.filter((r) => r.group === "approve")]
      .filter((r) => r.person && !seen.has(r.person.id) && seen.add(r.person.id))
      .slice(0, MAX);
    const ids = queue.map((r) => r.person!.id);
    const details = ids.length
      ? await db.crmPerson.findMany({
          where: { organizationId: orgId, id: { in: ids } },
          select: { id: true, title: true, company: { select: { name: true } } },
        })
      : [];
    const byId = new Map(details.map((d) => [d.id, d]));
    const drafts = ids.length
      ? await db.crmEmailMessage.findMany({
          where: {
            organizationId: orgId,
            status: "DRAFT",
            mailboxUserId: shell.user.id,
            personId: { in: ids },
          },
          orderBy: { createdAt: "desc" },
          select: { id: true, personId: true, subject: true, bodyText: true },
        })
      : [];
    const out: PowerPerson[] = [];
    for (const r of queue) {
      const id = r.person!.id;
      const links = await db.crmActivityTarget.findMany({
        where: { organizationId: orgId, targetKind: "person", targetId: id },
        orderBy: { occurredAt: "desc" },
        take: 6,
        select: { activityId: true },
      });
      const recent = links.length
        ? await db.crmActivity.findMany({
            where: {
              organizationId: orgId,
              id: { in: links.map((l) => l.activityId) },
              deletedAt: null,
              kind: { not: "SYSTEM" },
            },
            orderBy: { occurredAt: "desc" },
            take: 2,
            select: { subject: true, kind: true, occurredAt: true },
          })
        : [];
      // The draft this row is about (a waiting step's), else their latest.
      const own = r.actions.find((a) => a.type === "send-draft");
      const draft =
        (own?.type === "send-draft" ? drafts.find((d) => d.id === own.draftId) : undefined) ??
        drafts.find((d) => d.personId === id);
      const d = byId.get(id);
      out.push({
        id,
        name: r.name,
        sub: [r.tag, d?.title, d?.company?.name].filter(Boolean).join(", ") || null,
        whyShort: r.why,
        why: r.text,
        recent: recent
          .map(
            (a) =>
              `${a.occurredAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${(a.subject ?? a.kind.toLowerCase()).replace(/\.$/, "")}`,
          )
          .join(". "),
        email: r.person!.email,
        phone: r.person!.phone,
        draft: draft
          ? { id: draft.id, subject: draft.subject ?? "", body: draft.bodyText ?? "" }
          : null,
        reply: r.person!.reply,
      });
    }
    return out;
  });
  return <PowerCard orgId={orgId} people={people} />;
}
