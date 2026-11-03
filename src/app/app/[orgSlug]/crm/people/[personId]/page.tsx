import { Mail, Phone } from "@/components/icons";
import Link from "next/link";
import { notFound } from "next/navigation";

import { RecordAi } from "@/components/crm/ai/record-ai";
import { CrmTabs } from "@/components/crm/crm-tabs";
import { PhoneSection } from "@/components/crm/phone/phone-section";
import { RecordActions } from "@/components/crm/record-actions";
import { PersonOutreachSection } from "@/components/crm/outreach/person-section";
import { RecordFields } from "@/components/crm/record-fields";
import { RecordPage, Section, StrengthBadge, when } from "@/components/crm/record-page";
import { ScoreReasons } from "@/components/crm/score";
import { Timeline } from "@/components/crm/timeline";
import { LinkedFrom } from "@/components/databases/linked-from";
import { LinkedSection } from "@/components/links/linked-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { crmRecordHref } from "@/lib/crm/href";
import { formatMoney, STATUS_LABELS, type RecordStatus } from "@/lib/crm/fields";
import { crmDatabaseIds } from "@/server/crm/databases";
import { formContext, personForm, withRelationLabels } from "@/server/crm/forms";
import { ownerLabel } from "@/server/crm/owners";
import { presentHistory, presentTimeline } from "@/server/crm/present";
import { loadPerson } from "@/server/crm/records";
import { scoreReasons } from "@/server/crm/scoring";
import { withOrgTx } from "@/server/db/context";

import { crmShell } from "../../shell";

export const metadata = { title: "Person" };

/** A person: their fields, job history, items, what links to them, and their timeline. */
export default async function CrmPersonPage({ params }: PageProps<"/app/[orgSlug]/crm/people/[personId]">) {
  const { orgSlug, personId } = await params;
  const { gate, shell } = await crmShell(orgSlug);
  if (!shell) return gate;
  const orgId = shell.org.id;
  const data = await withOrgTx(orgId, async ({ db }) => {
    const loaded = await loadPerson(db, orgId, orgSlug, personId);
    if (!loaded) return null;
    const ids = await crmDatabaseIds(db, orgId);
    const def = ids.people
      ? await db.databaseDefinition.findFirst({
          where: { id: ids.people, organizationId: orgId },
          select: { columns: true },
        })
      : null;
    const fctx = await formContext(db, orgId, shell.roles);
    const form = await withRelationLabels(db, orgId, personForm(loaded.person, loaded.fields, fctx, def?.columns));
    const score = await scoreReasons(db, orgId, "person", loaded.person.id);
    return { ...loaded, form, score, timelineItems: await presentTimeline(db, orgId, loaded.timeline) };
  });
  if (!data) notFound();
  const { person } = data;
  const names = new Map(shell.members.map((m) => [m.id, m.name]));
  const owner = ownerLabel(person, shell.roles, names);
  const relationship = shell.access.settings?.relationshipTypes.find((t) => t.id === person.relationship);
  const base = `/app/${orgSlug}/crm`;
  const others = person.emails.filter((e) => !e.isPrimary).map((e) => e.email);
  return (
    <RecordPage
      tabs={<CrmTabs tabs={shell.tabs} />}
      back={{ href: `${base}/people`, label: "People" }}
      name={person.name}
      sub={
        person.title || person.company ? (
          <>
            {person.title}
            {person.title && person.company ? " at " : ""}
            {person.company && (
              <Link
                href={crmRecordHref(orgSlug, "company", person.company.id)}
                className="hover:text-foreground underline-offset-2 hover:underline"
              >
                {person.company.name}
              </Link>
            )}
          </>
        ) : undefined
      }
      badges={
        <>
          {person.deletedAt && <Badge variant="destructive">In the trash</Badge>}
          <Badge variant={person.status === "ACTIVE" ? "success" : "outline"}>
            {STATUS_LABELS[person.status as RecordStatus]}
          </Badge>
          {relationship && <Badge variant="secondary">{relationship.label}</Badge>}
          <StrengthBadge strength={person.strength} />
          {person.doNotContact && <Badge variant="destructive">Do not contact</Badge>}
          {person.userId && <Badge variant="info">Member</Badge>}
        </>
      }
      facts={[
        { label: "Owner", value: owner ?? "Nobody" },
        { label: "Last contacted", value: when(person.lastContactedAt) },
        { label: "Next follow-up", value: person.nextFollowUpAt ? when(person.nextFollowUpAt) : "Not set" },
        {
          label: "Knows them best",
          value: data.knowsBest.length
            ? data.knowsBest.map((k) => names.get(k.userId) ?? "A former member").join(", ")
            : "Nobody yet",
        },
      ]}
      actions={
        <>
          {person.primaryEmail && !person.doNotContact && (
            <Button asChild variant="outline" size="icon" title={`Email ${person.primaryEmail}`}>
              <a href={`mailto:${person.primaryEmail}`} aria-label="Email">
                <Mail className="size-4" aria-hidden="true" />
              </a>
            </Button>
          )}
          {person.phone && !person.doNotContact && (
            <Button asChild variant="outline" size="icon" title={`Call ${person.phone}`}>
              <a href={`tel:${person.phone}`} aria-label="Call">
                <Phone className="size-4" aria-hidden="true" />
              </a>
            </Button>
          )}
          <RecordActions
            orgId={orgId}
            orgSlug={orgSlug}
            kind="person"
            id={person.id}
            name={person.name}
            deleted={Boolean(person.deletedAt)}
            history={presentHistory(data.history, "person", data.fields, names)}
          />
        </>
      }
      side={
        <>
          <RecordAi orgId={orgId} orgSlug={orgSlug} kind="person" id={person.id} name={person.name} readOnly={Boolean(person.deletedAt)} />
          <Section title="Details">
            <RecordFields
              orgId={orgId}
              orgSlug={orgSlug}
              kind="person"
              id={person.id}
              fields={data.form}
              readOnly={Boolean(person.deletedAt)}
            />
            {others.length > 0 && <p className="text-muted-foreground text-sm">Also: {others.join(", ")}</p>}
          </Section>
          <PersonOutreachSection orgId={orgId} personId={person.id} viewerId={shell.user.id} roles={shell.roles} members={shell.members} />
          {data.deals.length > 0 && (
            <Section title="Items">
              <ul className="space-y-2 text-sm">
                {data.deals.map((d) => (
                  <li key={d.deal.id} className="flex items-center gap-2">
                    <Link
                      href={crmRecordHref(orgSlug, "deal", d.deal.id)}
                      className="min-w-0 flex-1 truncate font-semibold hover:underline"
                    >
                      {d.deal.title}
                    </Link>
                    <span className="text-muted-foreground text-xs">{d.deal.pipeline.name}</span>
                    <Badge
                      variant={
                        d.deal.stage.kind === "WON" ? "success" : d.deal.stage.kind === "LOST" ? "outline" : "secondary"
                      }
                    >
                      {d.deal.stage.name}
                    </Badge>
                    {d.deal.amountCents !== null && (
                      <span className="text-xs tabular-nums">{formatMoney(d.deal.amountCents, d.deal.currency)}</span>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {person.jobs.length > 0 && (
            <Section title="Job history">
              <ul className="space-y-1.5 text-sm">
                {person.jobs.map((j) => (
                  <li key={j.id} className="flex items-baseline gap-2">
                    {j.companyId ? (
                      <Link href={crmRecordHref(orgSlug, "company", j.companyId)} className="font-semibold hover:underline">
                        {j.companyName ?? "A company"}
                      </Link>
                    ) : (
                      <b>{j.companyName ?? "A company"}</b>
                    )}
                    {j.title && <span className="text-muted-foreground">{j.title}</span>}
                    <span className="text-muted-foreground ms-auto text-xs">
                      {j.current
                        ? "Now"
                        : j.endedOn
                          ? `Until ${j.endedOn.toLocaleDateString("en-US", { month: "short", year: "numeric" })}`
                          : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {data.contact && data.contact.sessionsAttended > 0 && (
            <Section title="At your events">
              <p className="text-sm">
                {data.contact.sessionsAttended} check-ins, the last {when(data.contact.lastCheckInAt).toLowerCase()}.
              </p>
            </Section>
          )}
          {data.linkedFrom.length > 0 && <LinkedFrom groups={data.linkedFrom} />}
          {(person.score > 0 || data.score.by !== "none") && (
            <Section title="Score">
              <ScoreReasons score={person.score} {...data.score} />
            </Section>
          )}
          <PhoneSection orgId={orgId} orgSlug={orgSlug} target={{ kind: "person", id: person.id }} />
          <LinkedSection orgId={orgId} orgSlug={orgSlug} at={{ kind: "crm-person", id: person.id }} title="Linked" />
        </>
      }
      main={
        <Timeline
          orgId={orgId}
          orgSlug={orgSlug}
          target={{ kind: "person", id: person.id }}
          initial={data.timelineItems}
          members={Object.fromEntries(names)}
          alsoOn={person.companyId ? [{ kind: "company", id: person.companyId }] : []}
        />
      }
    />
  );
}
