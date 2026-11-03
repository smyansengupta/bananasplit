import Link from "next/link";
import { notFound } from "next/navigation";

import { RecordAi } from "@/components/crm/ai/record-ai";
import { CrmTabs } from "@/components/crm/crm-tabs";
import { DealPeople } from "@/components/crm/deal-people";
import { RecordActions } from "@/components/crm/record-actions";
import { RecordFields } from "@/components/crm/record-fields";
import { RecordPage, Section, when } from "@/components/crm/record-page";
import { Timeline } from "@/components/crm/timeline";
import { LinkedFrom } from "@/components/databases/linked-from";
import { LinkedSection } from "@/components/links/linked-section";
import { Badge } from "@/components/ui/badge";
import { crmPipelineHref, crmRecordHref } from "@/lib/crm/href";
import { formatMoney } from "@/lib/crm/fields";
import { dealForm, formContext, withRelationLabels } from "@/server/crm/forms";
import { ownerLabel } from "@/server/crm/owners";
import { presentHistory, presentTimeline } from "@/server/crm/present";
import { daysInStage, isStuck } from "@/server/crm/queries";
import { loadDeal } from "@/server/crm/records";
import { withOrgTx } from "@/server/db/context";

import { crmShell } from "../../shell";

export const metadata = { title: "Item" };

/**
 * A pipeline item, called by its pipeline's noun: its stage (moved here or
 * on the board), people with their roles, company, next step, Finance when
 * it's a sponsorship, and its timeline.
 */
export default async function CrmItemPage({ params }: PageProps<"/app/[orgSlug]/crm/items/[itemId]">) {
  const { orgSlug, itemId } = await params;
  const { gate, shell } = await crmShell(orgSlug);
  if (!shell) return gate;
  const orgId = shell.org.id;
  const data = await withOrgTx(orgId, async ({ db }) => {
    const loaded = await loadDeal(db, orgId, orgSlug, itemId);
    if (!loaded) return null;
    const fctx = await formContext(db, orgId, shell.roles);
    const person = loaded.deal.primaryPersonId
      ? loaded.people.find((p) => p.person.id === loaded.deal.primaryPersonId)?.person.name
      : null;
    const form = await withRelationLabels(
      db,
      orgId,
      dealForm({ ...loaded.deal, personName: person ?? null }, loaded.deal.pipeline, loaded.fields, fctx),
    );
    return { ...loaded, form, timelineItems: await presentTimeline(db, orgId, loaded.timeline) };
  });
  if (!data) notFound();
  const { deal } = data;
  const names = new Map(shell.members.map((m) => [m.id, m.name]));
  const stages = new Map(deal.pipeline.stages.map((s) => [s.id, s.name]));
  const noun = deal.pipeline.itemNoun;
  const stuck = isStuck(deal, deal.stage.stuckAfterDays);
  return (
    <RecordPage
      square
      tabs={<CrmTabs tabs={shell.tabs} />}
      back={{ href: crmPipelineHref(orgSlug, deal.pipelineId), label: deal.pipeline.name }}
      name={deal.title}
      sub={
        <>
          {noun.charAt(0).toUpperCase() + noun.slice(1)}
          {deal.company && (
            <>
              {" with "}
              <Link href={crmRecordHref(orgSlug, "company", deal.company.id)} className="hover:text-foreground hover:underline">
                {deal.company.name}
              </Link>
            </>
          )}
        </>
      }
      badges={
        <>
          {deal.deletedAt && <Badge variant="destructive">In the trash</Badge>}
          <Badge variant={deal.stage.kind === "WON" ? "success" : deal.stage.kind === "LOST" ? "outline" : "secondary"}>
            {deal.stage.kind === "WON"
              ? `${deal.pipeline.wonLabel}: ${deal.stage.name}`
              : deal.stage.kind === "LOST"
                ? `${deal.pipeline.lostLabel}: ${deal.stage.name}`
                : deal.stage.name}
          </Badge>
          {stuck && <Badge variant="destructive">{daysInStage(deal)} days in {deal.stage.name}</Badge>}
          {!deal.closedAt && !deal.nextStep && <Badge variant="destructive">No next step</Badge>}
          {data.sponsorship && <Badge variant="info">Finance: {data.sponsorship.budgetPeriod.label}</Badge>}
        </>
      }
      facts={[
        { label: "Owner", value: ownerLabel(deal, shell.roles, names) ?? "Nobody" },
        ...(deal.pipeline.hasAmount ? [{ label: "Amount", value: formatMoney(deal.amountCents, deal.currency) || "Not set" }] : []),
        { label: "Expected", value: deal.expectedOn ? when(deal.expectedOn) : "Not set" },
        { label: "In this stage", value: `${daysInStage(deal)} days` },
      ]}
      actions={
        <RecordActions
          orgId={orgId}
          orgSlug={orgSlug}
          kind="deal"
          id={deal.id}
          name={deal.title}
          deleted={Boolean(deal.deletedAt)}
          canTrash={!deal.sponsorshipId}
          history={presentHistory(data.history, "deal", data.fields, names, stages)}
        />
      }
      side={
        <>
          <RecordAi orgId={orgId} orgSlug={orgSlug} kind="deal" id={deal.id} name={deal.title} readOnly={Boolean(deal.deletedAt)} />
          <Section title="Details">
            <RecordFields orgId={orgId} orgSlug={orgSlug} kind="deal" id={deal.id} fields={data.form} readOnly={Boolean(deal.deletedAt)} />
            {deal.sponsorshipId && (
              <p className="text-muted-foreground text-xs">
                This {noun} is Finance&apos;s sponsorship: moving it to Received books the money, and only owners, admins and
                treasurers move it.
              </p>
            )}
          </Section>
          <Section title="People">
            <DealPeople
              orgId={orgId}
              orgSlug={orgSlug}
              dealId={deal.id}
              people={data.people.map((p) => ({ id: p.person.id, name: p.person.name, role: p.role, sub: p.person.title }))}
            />
          </Section>
          {data.linkedFrom.length > 0 && <LinkedFrom groups={data.linkedFrom} />}
          <LinkedSection orgId={orgId} orgSlug={orgSlug} at={{ kind: "crm-deal", id: deal.id }} title="Linked" />
        </>
      }
      main={
        <Timeline
          orgId={orgId}
          orgSlug={orgSlug}
          target={{ kind: "deal", id: deal.id }}
          initial={data.timelineItems}
          members={Object.fromEntries(names)}
          alsoOn={[
            ...(deal.companyId ? [{ kind: "company" as const, id: deal.companyId }] : []),
            ...data.people.map((p) => ({ kind: "person" as const, id: p.person.id })),
          ]}
        />
      }
    />
  );
}
