import { Section } from "@/components/crm/record-page";
import { deliverablesOf, guestLinksOf } from "@/server/crm/outreach/partners";
import { contactable } from "@/server/crm/outreach/send";
import { composeTemplates } from "@/server/crm/outreach/view";
import { withOrgTx } from "@/server/db/context";

import { ComposeButton } from "./compose";
import { PartnerPanel } from "./partner-panel";

/**
 * Reaching out from a company or a pipeline item: write to any of its
 * people (the item's email lands on the item's timeline too); and on an
 * item, what we owe them, with the partner's guest link. Reads in its own
 * transaction, so the record page only places it.
 */
export async function RecordOutreachSection({ orgId, kind, id }: { orgId: string; kind: "company" | "deal"; id: string }) {
  const data = await withOrgTx(orgId, async ({ db }) => {
    const people =
      kind === "company"
        ? await db.crmPerson.findMany({
            where: { organizationId: orgId, companyId: id, deletedAt: null },
            orderBy: [{ strength: "desc" }, { name: "asc" }],
            take: 30,
            select: { id: true, name: true, primaryEmail: true, doNotContact: true, unsubscribedAt: true, consent: true, deletedAt: true },
          })
        : (
            await db.crmDealPerson.findMany({
              where: { organizationId: orgId, dealId: id },
              select: { person: { select: { id: true, name: true, primaryEmail: true, doNotContact: true, unsubscribedAt: true, consent: true, deletedAt: true } } },
              take: 30,
            })
          )
            .map((d) => d.person)
            .filter((p) => !p.deletedAt);
    return {
      people: people.map((p) => {
        const c = contactable(p);
        return { id: p.id, name: p.name, email: p.primaryEmail, blocked: c.ok ? null : c.reason };
      }),
      templates: await composeTemplates(db, orgId),
      deliverables: kind === "deal" ? await deliverablesOf(db, orgId, id) : [],
      links: kind === "deal" ? await guestLinksOf(db, orgId, id) : [],
    };
  });
  return (
    <>
      {data.people.length > 0 && (
        <Section
          title="Reaching out"
          action={<ComposeButton orgId={orgId} people={data.people} templates={data.templates} dealId={kind === "deal" ? id : undefined} size="sm" />}
        >
          <p className="text-muted-foreground text-sm">
            Write to {data.people.length === 1 ? data.people[0]!.name : `any of their ${data.people.length} people`}; it goes on {kind === "deal" ? "this item's" : "the company's"} timeline too.
          </p>
        </Section>
      )}
      {kind === "deal" && (
        <Section title="What we owe them">
          <PartnerPanel
            orgId={orgId}
            dealId={id}
            deliverables={data.deliverables.map((d) => ({ id: d.id, title: d.title, dueOn: d.dueOn?.toISOString() ?? null, done: d.done, taskId: d.taskId }))}
            links={data.links.map((l) => ({ id: l.id, url: l.url, lastViewedAt: l.lastViewedAt?.toISOString() ?? null }))}
          />
        </Section>
      )}
    </>
  );
}
