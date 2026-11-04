import { PersonCard, type PersonCardData } from "@/components/crm/cards/person-card";
import { formatMoney } from "@/lib/crm/fields";
import { issueSourceLabel, issueSources, readIssue } from "@/lib/crm/issue";
import { appOrigin } from "@/lib/app-url";
import { crmDatabaseIds } from "@/server/crm/databases";
import { readEnrichment, summaryOf } from "@/server/crm/enrichment-store";
import { formContext, personForm, withRelationLabels } from "@/server/crm/forms";
import { ownerLabel } from "@/server/crm/owners";
import { phoneStatus } from "@/server/crm/phone/connection";
import { timeline } from "@/server/crm/activity";
import { presentHistory, presentTimeline } from "@/server/crm/present";
import { loadPerson } from "@/server/crm/records";
import { conflictFor, contactable } from "@/server/crm/outreach/send";
import { canStopEnrollment } from "@/server/crm/outreach/sequences";
import { composeTemplates } from "@/server/crm/outreach/view";
import { withOrgTx } from "@/server/db/context";

import { crmCanEnrich, crmMembers } from "@/app/app/[orgSlug]/crm/shell";

import type { OverlayProps } from "./crm-overlays";

const DAY = 86_400_000;

function shortDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function daysAgo(d: Date, now: Date): string {
  const n = Math.floor((now.getTime() - d.getTime()) / DAY);
  return n <= 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`;
}

/** A person's card (?open=person:<id>): everything its four tabs and its composer need. */
export async function PersonOverlay({ shell, orgSlug, open }: OverlayProps<"person">) {
  const orgId = shell.org.id;
  const viewerId = shell.user.id;
  const now = new Date();
  const personId = open.id;
  // Three reads at once, each in its own transaction (one transaction runs
  // one query at a time): the person and what hangs off their record; what
  // the card offers around them (their unanswered mail, a waiting step, the
  // composer's templates, the series, the booking link); and the members.
  // Whatever the viewer can't see stays out of the first, and the card shows
  // nothing then.
  const statusP = phoneStatus(orgId).catch(() => null);
  const membersP = crmMembers(orgId);
  const aroundP = withOrgTx(orgId, async ({ db }) => {
    // Their latest message to us that nobody has answered: the one thing to do.
    // Incoming mail is tied to them through its timeline entry.
    const touchIds = (
      await db.crmActivityTarget.findMany({
        where: { organizationId: orgId, targetKind: "person", targetId: personId },
        orderBy: { occurredAt: "desc" },
        take: 100,
        select: { activityId: true },
      })
    ).map((t) => t.activityId);
    const inbound = await db.crmEmailMessage.findFirst({
      where: {
        organizationId: orgId,
        direction: "INBOUND",
        OR: [{ personId }, { activityId: { in: touchIds } }],
        status: "RECEIVED",
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        threadId: true,
        subject: true,
        bodyText: true,
        createdAt: true,
        mailboxUserId: true,
      },
    });
    const answered = inbound
      ? await db.crmEmailMessage.count({
          where: {
            organizationId: orgId,
            threadId: inbound.threadId,
            direction: "OUTBOUND",
            createdAt: { gt: inbound.createdAt },
          },
        })
      : 0;
    // An open step a sequence left for the viewer: it's their next step.
    const step = await db.crmActivity.findFirst({
      where: {
        organizationId: orgId,
        kind: "SEQUENCE_STEP",
        deletedAt: null,
        meta: { path: ["open"], equals: true },
        targets: { some: { targetKind: "person", targetId: personId } },
      },
      orderBy: { occurredAt: "asc" },
      select: { id: true, subject: true, occurredAt: true },
    });
    // The "/" menu's booking links: your own first, then the organization's
    // (Meetings > Booking links; docs/features/booking.md).
    const bookingLinks = await db.crmBookingPage.findMany({
      where: { organizationId: orgId, active: true, OR: [{ ownerUserId: viewerId }, { ownerUserId: null }] },
      orderBy: { createdAt: "asc" },
      select: { slug: true, title: true, ownerUserId: true },
      take: 20,
    });
    return {
      replyTo: inbound && !answered ? inbound : null,
      step,
      booking: [
        ...bookingLinks.filter((b) => b.ownerUserId === viewerId),
        ...bookingLinks.filter((b) => b.ownerUserId !== viewerId),
      ].map((b) => ({
        label: b.ownerUserId ? "my booking link" : b.title,
        url: `${appOrigin()}/book/${b.slug}`,
      })),
      templates: await composeTemplates(db, orgId),
      series: await db.crmSequence.findMany({
        where: { organizationId: orgId, archivedAt: null, status: "ON" },
        orderBy: { name: "asc" },
        take: 50,
        select: { id: true, name: true },
      }),
      // The series they're in now, and whether the viewer may take them out.
      enrollments: (
        await db.crmEnrollment.findMany({
          where: { organizationId: orgId, personId, status: { in: ["ACTIVE", "PAUSED"] } },
          orderBy: { startedAt: "asc" },
          take: 10,
          select: {
            id: true,
            senderId: true,
            enrolledById: true,
            sequence: { select: { name: true, createdById: true } },
          },
        })
      ).map((e) => ({
        id: e.id,
        name: e.sequence.name,
        canStop: shell.access.manager || canStopEnrollment(viewerId, e),
      })),
    };
  });
  const recordP = withOrgTx(orgId, async ({ db }) => {
    const loaded = await loadPerson(db, orgId, orgSlug, personId);
    if (!loaded) return null;
    const { person } = loaded;
    const ids = await crmDatabaseIds(db, orgId);
    const def = ids.people
      ? await db.databaseDefinition.findFirst({
          where: { id: ids.people, organizationId: orgId },
          select: { columns: true },
        })
      : null;
    const fctx = await formContext(db, orgId, shell.roles);
    const form = await withRelationLabels(
      db,
      orgId,
      personForm(person, loaded.fields, fctx, def?.columns),
    );
    const enrichment = await readEnrichment(db, orgId, { kind: "person", id: person.id });
    const summary = summaryOf(enrichment);
    // Their notes (the NOTE entries of the timeline), and their biggest issue with what it came from.
    const notes = await timeline(db, orgId, { kind: "person", id: person.id }, { kinds: ["NOTE"], take: 100 });
    const issue = readIssue(enrichment);
    const issueKinds = issue?.sources.length
      ? await db.crmActivity.findMany({
          where: { organizationId: orgId, id: { in: issue.sources } },
          select: { kind: true, direction: true },
        })
      : [];

    const conflict = await conflictFor(db, orgId, person.id, viewerId, now);

    // Money: what their company pledged through Finance and what came in.
    let money: PersonCardData["money"] = null;
    if (person.company?.sponsorId) {
      const rows = await db.sponsorship
        .findMany({
          where: { organizationId: orgId, sponsorId: person.company.sponsorId },
          select: { amountCents: true, status: true, type: true },
        })
        .catch(() => []);
      const pledged = rows
        .filter((s) => s.status !== "DECLINED" && s.status !== "WRITTEN_OFF")
        .reduce((n, s) => n + s.amountCents, 0);
      const paid = rows
        .filter((s) => s.status === "RECEIVED" && s.type === "CASH")
        .reduce((n, s) => n + s.amountCents, 0);
      if (pledged > 0)
        money = {
          paid: formatMoney(paid),
          pledged: formatMoney(pledged),
          owed: formatMoney(Math.max(0, pledged - paid)),
          due: pledged > paid,
          company: person.company.name,
        };
    }

    return {
      loaded,
      form,
      summary,
      notes,
      issue: issue ? { ...issue, from: issueSourceLabel(issue, issueKinds) } : null,
      conflict,
      money,
      timelineItems: await presentTimeline(db, orgId, loaded.timeline),
    };
  });
  const [status, record, around, members, canEnrich] = await Promise.all([
    statusP,
    recordP,
    aroundP,
    membersP,
    crmCanEnrich(orgId),
  ]);
  if (!record) return <PersonCard orgId={orgId} orgSlug={orgSlug} data={null} />;
  const data = { ...record, ...around };
  const { person } = data.loaded;
  const names = new Map(members.map((m) => [m.id, m.name]));
  const conflictName = data.conflict ? (names.get(data.conflict.userId) ?? "Another member") : null;
  const relationship = shell.access.settings?.relationshipTypes.find(
    (t) => t.id === person.relationship,
  );
  const email = contactable({ ...person, primaryEmail: person.primaryEmail });
  const texting = Boolean(status?.active && status.number);
  const latest = data.timelineItems[0] ?? null;

  const card: PersonCardData = {
    id: person.id,
    name: person.name,
    title: person.title,
    company: person.company ? { id: person.company.id, name: person.company.name } : null,
    relationship: relationship?.label ?? null,
    phone: person.doNotContact ? null : person.phone,
    deleted: Boolean(person.deletedAt),
    // A Personal space has one owner: no "Owner:" line or Owner field.
    owner: shell.access.personal ? null : ownerLabel(person, shell.roles, names),
    nextStep: data.step
      ? {
          kind: "step",
          id: data.step.id,
          label: data.step.subject ?? "A step from a sequence",
          at: data.step.occurredAt.toISOString(),
        }
      : person.nextFollowUpAt
        ? {
            kind: "followup",
            id: null,
            label: "Follow up",
            at: person.nextFollowUpAt.toISOString(),
          }
        : null,
    brief: data.summary ? { text: data.summary.text, points: data.summary.points } : null,
    latest: data.replyTo
      ? {
          title: `${person.name.split(" ")[0]} wrote: ${data.replyTo.subject ?? "a reply"}`,
          when: shortDate(data.replyTo.createdAt),
          text: (data.replyTo.bodyText ?? "").replace(/\s+/g, " ").trim().slice(0, 220),
          reply: { messageId: data.replyTo.id, subject: data.replyTo.subject ?? "" },
          why: `They wrote ${daysAgo(data.replyTo.createdAt, now)}, nobody has answered`,
        }
      : latest
        ? {
            title: latest.subject ?? "Activity",
            when: shortDate(new Date(latest.occurredAt)),
            text: (latest.body ?? "").replace(/\s+/g, " ").trim().slice(0, 220),
            reply: null,
            why: null,
          }
        : null,
    money: data.money,
    deals: data.loaded.deals.map((d) => ({
      id: d.deal.id,
      title: d.deal.title,
      stage: d.deal.stage.name,
      kind: d.deal.stage.kind,
      amount: d.deal.amountCents !== null ? formatMoney(d.deal.amountCents, d.deal.currency) : null,
      pipeline: d.deal.pipeline.name,
    })),
    form: shell.access.personal ? data.form.filter((f) => f.key !== "owner") : data.form,
    timeline: data.timelineItems,
    notes: data.notes.map((n) => ({
      id: n.id,
      subject: n.subject,
      body: n.body,
      occurredAt: n.occurredAt.toISOString(),
      by: names.get(n.actorId ?? n.createdById ?? "") ?? null,
      canEdit: shell.access.admin || n.createdById === viewerId,
      about: null,
    })),
    issue: data.issue,
    issueSources: issueSources(data.loaded.timeline).length,
    history: presentHistory(data.loaded.history, "person", data.loaded.fields, names),
    members: Object.fromEntries(names),
    channels: {
      email: email.ok ? { to: person.primaryEmail! } : null,
      emailBlocked: email.ok ? null : email.reason,
      text: texting && person.phone && !person.doNotContact ? { to: person.phone } : null,
    },
    conflict: data.conflict
      ? `${conflictName} ${data.conflict.what}${data.conflict.at ? ` ${shortDate(data.conflict.at)}` : ""}`
      : null,
    templates: data.templates,
    booking: data.booking,
    series: data.series,
    enrollments: data.enrollments,
    canEnrich,
  };
  return <PersonCard orgId={orgId} orgSlug={orgSlug} data={card} />;
}
