import { Globe } from "@/components/icons";
import Link from "next/link";
import { notFound } from "next/navigation";

import { RecordAi } from "@/components/crm/ai/record-ai";
import { CrmTabs } from "@/components/crm/crm-tabs";
import { PhoneSection } from "@/components/crm/phone/phone-section";
import { RecordActions } from "@/components/crm/record-actions";
import { RecordFields } from "@/components/crm/record-fields";
import { RecordPage, Section, StrengthBadge, when } from "@/components/crm/record-page";
import { Timeline } from "@/components/crm/timeline";
import { LinkedFrom } from "@/components/databases/linked-from";
import { LinkedSection } from "@/components/links/linked-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { crmRecordHref } from "@/lib/crm/href";
import { formatMoney, STATUS_LABELS, type RecordStatus } from "@/lib/crm/fields";
import { crmDatabaseIds } from "@/server/crm/databases";
import { companyForm, formContext, withRelationLabels } from "@/server/crm/forms";
import { ownerLabel } from "@/server/crm/owners";
import { presentHistory, presentTimeline } from "@/server/crm/present";
import { loadCompany } from "@/server/crm/records";
import { withOrgTx } from "@/server/db/context";

import { crmShell } from "../../shell";

export const metadata = { title: "Company" };

/**
 * A company: its people (and who used to work there), its items, Finance on
 * it (pledged and received), what links to it, and one timeline with its
 * people's.
 */
export default async function CrmCompanyPage({ params }: PageProps<"/app/[orgSlug]/crm/companies/[companyId]">) {
  const { orgSlug, companyId } = await params;
  const { gate, shell } = await crmShell(orgSlug);
  if (!shell) return gate;
  const orgId = shell.org.id;
  const data = await withOrgTx(orgId, async ({ db }) => {
    const loaded = await loadCompany(db, orgId, orgSlug, companyId);
    if (!loaded) return null;
    const ids = await crmDatabaseIds(db, orgId);
    const def = ids.companies
      ? await db.databaseDefinition.findFirst({
          where: { id: ids.companies, organizationId: orgId },
          select: { columns: true },
        })
      : null;
    const fctx = await formContext(db, orgId, shell.roles);
    const form = await withRelationLabels(db, orgId, companyForm(loaded.company, loaded.fields, fctx, def?.columns));
    return { ...loaded, form, timelineItems: await presentTimeline(db, orgId, loaded.timeline) };
  });
  if (!data) notFound();
  const { company } = data;
  const names = new Map(shell.members.map((m) => [m.id, m.name]));
  const base = `/app/${orgSlug}/crm`;
  return (
    <RecordPage
      square
      tabs={<CrmTabs tabs={shell.tabs} />}
      back={{ href: `${base}/companies`, label: "Companies" }}
      name={company.name}
      sub={[company.industry, company.domain].filter(Boolean).join(", ") || undefined}
      badges={
        <>
          {company.deletedAt && <Badge variant="destructive">In the trash</Badge>}
          <Badge variant={company.status === "ACTIVE" ? "success" : "outline"}>
            {STATUS_LABELS[company.status as RecordStatus]}
          </Badge>
          <StrengthBadge strength={company.strength} />
          {company.sponsorId && <Badge variant="info">Finance sponsor</Badge>}
        </>
      }
      facts={[
        { label: "Owner", value: ownerLabel(company, shell.roles, names) ?? "Nobody" },
        { label: "Last contacted", value: when(company.lastContactedAt) },
        {
          label: data.money.count ? "Received" : "People",
          value: data.money.count
            ? `${formatMoney(data.money.received)} of ${formatMoney(data.money.pledged)}`
            : String(data.people.length),
        },
        {
          label: "Knows them best",
          value: data.knowsBest.length
            ? data.knowsBest.map((k) => names.get(k.userId) ?? "A former member").join(", ")
            : "Nobody yet",
        },
      ]}
      actions={
        <>
          {company.website && (
            <Button asChild variant="outline" size="icon" title={company.website}>
              <a href={company.website} target="_blank" rel="noreferrer" aria-label="Website">
                <Globe className="size-4" aria-hidden="true" />
              </a>
            </Button>
          )}
          <RecordActions
            orgId={orgId}
            orgSlug={orgSlug}
            kind="company"
            id={company.id}
            name={company.name}
            deleted={Boolean(company.deletedAt)}
            history={presentHistory(data.history, "company", data.fields, names)}
          />
        </>
      }
      side={
        <>
          <RecordAi orgId={orgId} orgSlug={orgSlug} kind="company" id={company.id} name={company.name} readOnly={Boolean(company.deletedAt)} />
          <Section title="Details">
            <RecordFields
              orgId={orgId}
              orgSlug={orgSlug}
              kind="company"
              id={company.id}
              fields={data.form}
              readOnly={Boolean(company.deletedAt)}
            />
          </Section>
          <Section
            title={`People (${data.people.length})`}
            action={
              <Button asChild size="sm" variant="outline">
                <Link href={`${base}/people?new=1`}>Add</Link>
              </Button>
            }
          >
            {data.people.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nobody here yet.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {data.people.map((p) => (
                  <li key={p.id} className="flex items-baseline gap-2">
                    <Link href={crmRecordHref(orgSlug, "person", p.id)} className="font-semibold hover:underline">
                      {p.name}
                    </Link>
                    {p.title && <span className="text-muted-foreground truncate">{p.title}</span>}
                    <span className="text-muted-foreground ms-auto text-xs">{when(p.lastContactedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
            {data.past.length > 0 && (
              <p className="text-muted-foreground text-xs">
                Used to work here: {data.past.map((p) => p.person.name).join(", ")}
              </p>
            )}
          </Section>
          {data.deals.length > 0 && (
            <Section title="Items">
              <ul className="space-y-2 text-sm">
                {data.deals.map((d) => (
                  <li key={d.id} className="flex items-center gap-2">
                    <Link
                      href={crmRecordHref(orgSlug, "deal", d.id)}
                      className="min-w-0 flex-1 truncate font-semibold hover:underline"
                    >
                      {d.title}
                    </Link>
                    <Badge variant={d.stage.kind === "WON" ? "success" : d.stage.kind === "LOST" ? "outline" : "secondary"}>
                      {d.stage.name}
                    </Badge>
                    {d.amountCents !== null && (
                      <span className="text-xs tabular-nums">{formatMoney(d.amountCents, d.currency)}</span>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {data.linkedFrom.length > 0 && <LinkedFrom groups={data.linkedFrom} />}
          <PhoneSection orgId={orgId} orgSlug={orgSlug} target={{ kind: "company", id: company.id }} />
          <LinkedSection orgId={orgId} orgSlug={orgSlug} at={{ kind: "crm-company", id: company.id }} title="Linked" />
        </>
      }
      main={
        <Timeline
          orgId={orgId}
          orgSlug={orgSlug}
          target={{ kind: "company", id: company.id }}
          initial={data.timelineItems}
          members={Object.fromEntries(names)}
        />
      }
    />
  );
}
