import { MergeCard, type MergeCardData, type MergeSideData } from "@/components/crm/cards/merge-card";
import { scoreCompanies, scorePeople } from "@/lib/crm/dedupe";
import { duplicateReason } from "@/lib/crm/people-view";
import type { MergePayload } from "@/server/crm/dedupe";
import { ownerLabel } from "@/server/crm/owners";
import { withOrgTx } from "@/server/db/context";

import type { OverlayProps } from "./crm-overlays";

function added(source: string | null, at: Date): string {
  const when = at.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const from =
    !source || source === "manual"
      ? "Added by hand"
      : source === "import"
        ? "Import"
        : source.charAt(0).toUpperCase() + source.slice(1).replace(/[-_]/g, " ");
  return `${from}, ${when}`;
}

/** ["Same name", "Same phone"] as "Same name and same phone". */
function sentence(reasons: readonly string[]): string {
  const parts = reasons.map((r, i) => (i ? r.charAt(0).toLowerCase() + r.slice(1) : r));
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : (parts[0] ?? "");
}

/**
 * The Merge card (?open=merge:<a>,<b>, Merge.dc.html): two people (or two
 * companies) side by side, a pick per field, and what moves. Kept apart
 * with Keep both, so they're never suggested again.
 */
export async function MergeOverlay({ shell, open }: OverlayProps<"merge">) {
  const orgId = shell.org.id;
  const names = new Map(shell.members.map((m) => [m.id, m.name]));
  const relationships = new Map(
    (shell.access.settings?.relationshipTypes ?? []).map((t) => [t.id, t.label]),
  );
  const data = await withOrgTx(orgId, async ({ db }): Promise<MergeCardData | null> => {
    const [a, b] = open.ids;
    const pending = await db.crmSuggestion.findMany({
      where: { organizationId: orgId, kind: "MERGE", status: "PENDING", targetId: { in: [a, b] } },
      select: { payload: true },
      take: 20,
    });
    const suggested = pending
      .map((s) => s.payload as unknown as MergePayload | null)
      .find((p) => p?.ids?.includes(a) && p.ids.includes(b));
    const counts = async (kind: "person" | "company", id: string) => ({
      activities: await db.crmActivityTarget.count({
        where: { organizationId: orgId, targetKind: kind, targetId: id },
      }),
      deals:
        kind === "person"
          ? await db.crmDealPerson.count({ where: { organizationId: orgId, personId: id, deal: { deletedAt: null } } })
          : await db.crmDeal.count({ where: { organizationId: orgId, companyId: id, deletedAt: null } }),
    });

    const people = await db.crmPerson.findMany({
      where: { organizationId: orgId, id: { in: [a, b] }, deletedAt: null },
      select: {
        id: true,
        name: true,
        primaryEmail: true,
        phone: true,
        companyId: true,
        company: { select: { name: true } },
        ownerId: true,
        ownerRoleKey: true,
        relationship: true,
        source: true,
        createdAt: true,
        emails: { select: { email: true } },
      },
    });
    if (people.length === 2) {
      const ordered = [people.find((p) => p.id === a)!, people.find((p) => p.id === b)!];
      const sides = await Promise.all(
        ordered.map(async (p): Promise<MergeSideData> => {
          const c = await counts("person", p.id);
          return {
            id: p.id,
            name: p.name,
            line: added(p.source, p.createdAt),
            activities: c.activities,
            deals: c.deals,
            values: {
              name: p.name,
              primaryEmail: p.primaryEmail,
              phone: p.phone,
              companyId: p.companyId,
              ownerId: p.ownerId,
            },
            labels: {
              name: p.name,
              primaryEmail: p.primaryEmail,
              phone: p.phone,
              companyId: p.company?.name ?? null,
              ownerId: ownerLabel(p, shell.roles, names),
            },
          };
        }),
      );
      const [pa, pb] = ordered as [(typeof ordered)[number], (typeof ordered)[number]];
      const score = scorePeople(
        { id: pa.id, name: pa.name, phone: pa.phone, companyId: pa.companyId, emails: pa.emails.map((e) => e.email) },
        { id: pb.id, name: pb.name, phone: pb.phone, companyId: pb.companyId, emails: pb.emails.map((e) => e.email) },
      );
      const reasons = suggested?.reasons?.length ? suggested.reasons : score.reasons;
      const same = [
        pa.relationship && pa.relationship === pb.relationship
          ? (relationships.get(pa.relationship) ?? pa.relationship)
          : null,
        pa.companyId && pa.companyId === pb.companyId ? pa.company?.name : null,
      ].filter((v): v is string => Boolean(v));
      return {
        kind: "person",
        why: reasons.length ? `${sentence(reasons)}.` : null,
        sides: [sides[0]!, sides[1]!],
        same,
      };
    }

    const companies = await db.crmCompany.findMany({
      where: { organizationId: orgId, id: { in: [a, b] }, deletedAt: null },
      select: { id: true, name: true, domain: true, website: true, ownerId: true, ownerRoleKey: true, createdAt: true },
    });
    if (companies.length !== 2) return null;
    const ordered = [companies.find((c) => c.id === a)!, companies.find((c) => c.id === b)!];
    const sides = await Promise.all(
      ordered.map(async (c): Promise<MergeSideData> => {
        const n = await counts("company", c.id);
        return {
          id: c.id,
          name: c.name,
          line: added(null, c.createdAt).replace("Added by hand", "Added"),
          activities: n.activities,
          deals: n.deals,
          values: { name: c.name, primaryEmail: null, phone: null, companyId: null, ownerId: c.ownerId },
          labels: {
            name: c.name,
            primaryEmail: c.domain ?? c.website,
            phone: null,
            companyId: null,
            ownerId: ownerLabel(c, shell.roles, names),
          },
        };
      }),
    );
    const score = scoreCompanies(ordered[0]!, ordered[1]!);
    const reasons = suggested?.reasons?.length ? suggested.reasons : score.reasons;
    return {
      kind: "company",
      why: reasons.length ? `${duplicateReason(reasons[0]!, ordered[1]!.name)}.` : null,
      sides: [sides[0]!, sides[1]!],
      same: [],
    };
  });
  return <MergeCard orgId={shell.org.id} data={data} />;
}
