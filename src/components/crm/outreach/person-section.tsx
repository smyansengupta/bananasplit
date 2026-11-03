import { Section } from "@/components/crm/record-page";
import { Badge } from "@/components/ui/badge";
import { appUrl } from "@/lib/app-url";
import { formatMoney } from "@/lib/crm/fields";
import { ownerLabel, type RoleOwner } from "@/server/crm/owners";
import { givingFor } from "@/server/crm/outreach/giving";
import { contactable, conflictFor, draftsFor } from "@/server/crm/outreach/send";
import { selfUpdateToken, selfUpdateUrl, sha256 } from "@/server/crm/outreach/tokens";
import { composeTemplates } from "@/server/crm/outreach/view";
import { withOrgTx } from "@/server/db/context";

import { ComposeButton, OpenDraftButton } from "./compose";
import { PersonOutreachControls } from "./person-controls";

/**
 * Reaching out, on a person's page (docs/features/crm.md, module 5): write
 * to them, who owns the relationship and who talked to them last (and a
 * warning when another member is in the middle of it), keep in touch and
 * follow-ups, sequences, invites, how their email is landing, their own
 * update link; and what they've given and volunteered, from Finance and
 * Events. Reads in its own transaction, so the page only places it.
 */
export async function PersonOutreachSection({
  orgId,
  personId,
  viewerId,
  roles,
  members,
}: {
  orgId: string;
  personId: string;
  viewerId: string;
  roles: ReadonlyMap<string, RoleOwner>;
  members: readonly { id: string; name: string }[];
}) {
  const names = new Map(members.map((m) => [m.id, m.name]));
  const data = await withOrgTx(orgId, async ({ db }) => {
    const p = await db.crmPerson.findFirst({
      where: { id: personId, organizationId: orgId },
      select: {
        id: true,
        name: true,
        primaryEmail: true,
        phone: true,
        doNotContact: true,
        unsubscribedAt: true,
        consent: true,
        deletedAt: true,
        ownerId: true,
        ownerRoleKey: true,
        keepInTouchDays: true,
        selfUpdateTokenHash: true,
        contactId: true,
        company: { select: { name: true } },
      },
    });
    if (!p) return null;
    const conflict = await conflictFor(db, orgId, p.id, viewerId);
    const links = await db.crmActivityTarget.findMany({
      where: { organizationId: orgId, targetKind: "person", targetId: p.id },
      orderBy: { occurredAt: "desc" },
      take: 60,
      select: { activityId: true },
    });
    const last = links.length
      ? await db.crmActivity.findFirst({
          where: { organizationId: orgId, id: { in: links.map((l) => l.activityId) }, deletedAt: null, kind: { in: ["EMAIL", "CALL", "MEETING", "TEXT"] }, actorId: { not: null } },
          orderBy: { occurredAt: "desc" },
          select: { actorId: true, occurredAt: true, kind: true },
        })
      : null;
    const enrollments = await db.crmEnrollment.findMany({
      where: { organizationId: orgId, personId: p.id },
      orderBy: { startedAt: "desc" },
      take: 10,
      select: { id: true, status: true, nextStep: true, sequence: { select: { name: true } } },
    });
    const sequences = await db.crmSequence.findMany({ where: { organizationId: orgId, status: "ON", archivedAt: null }, select: { id: true, name: true }, take: 20 });
    const events = await db.event.findMany({
      where: { organizationId: orgId, deletedAt: null, rsvpEnabled: true, rsvpSlug: { not: null }, startsAt: { gte: new Date() } },
      orderBy: { startsAt: "asc" },
      take: 2,
      select: { title: true, rsvpSlug: true },
    });
    const forms = await db.form.findMany({
      where: { organizationId: orgId, deletedAt: null, publishedAt: { not: null }, closedAt: null, access: "ANYONE" },
      orderBy: { updatedAt: "desc" },
      take: 1,
      select: { title: true, slug: true },
    });
    const sent = await db.crmEmailMessage.findMany({
      where: { organizationId: orgId, direction: "OUTBOUND", status: { in: ["SENT", "BOUNCED"] }, toAddresses: p.primaryEmail ? { has: p.primaryEmail } : undefined },
      select: { openCount: true, clickCount: true, repliedAt: true, status: true },
      take: 200,
    });
    const linkOn = p.selfUpdateTokenHash && p.selfUpdateTokenHash === sha256(selfUpdateToken(orgId, p.id));
    return {
      p,
      conflict,
      last,
      enrollments,
      sequences,
      invites: [
        ...events.map((e) => ({ label: e.title, url: appUrl(`/e/${e.rsvpSlug}`), subject: `Come to ${e.title}` })),
        ...forms.map((f) => ({ label: f.title, url: appUrl(`/f/${f.slug}`), subject: f.title })),
      ],
      templates: await composeTemplates(db, orgId),
      giving: await givingFor(db, orgId, { id: p.id, name: p.name, contactId: p.contactId, company: p.company }),
      mail: {
        sent: sent.length,
        opened: sent.filter((s) => s.openCount > 0).length,
        clicked: sent.filter((s) => s.clickCount > 0).length,
        replied: sent.filter((s) => s.repliedAt).length,
        bounced: sent.filter((s) => s.status === "BOUNCED").length,
      },
      selfUpdate: linkOn ? selfUpdateUrl(orgId, p.id) : null,
      // Unsent drafts waiting in the viewer's compose (an AI draft, an automation's to look over).
      drafts: await draftsFor(db, orgId, p.id, viewerId),
    };
  });
  if (!data) return null;
  const { p, giving, mail } = data;
  const can = contactable(p);
  const owner = ownerLabel(p, roles, names);
  return (
    <>
      <Section
        title="Reaching out"
        action={
          <ComposeButton
            orgId={orgId}
            people={[{ id: p.id, name: p.name, email: p.primaryEmail, blocked: can.ok ? null : can.reason }]}
            templates={data.templates}
            size="sm"
          />
        }
      >
        <div className="space-y-1 text-sm">
          <p>
            <span className="text-muted-foreground">Owner: </span>
            {owner ?? "Nobody yet"}
          </p>
          <p>
            <span className="text-muted-foreground">Last talked to them: </span>
            {data.last
              ? `${data.last.actorId === viewerId ? "you" : (names.get(data.last.actorId!) ?? "a former member")}, ${data.last.occurredAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
              : "nobody yet"}
          </p>
          {data.conflict && (
            <p className="bg-tint-accent text-tint-accent-foreground rounded-xl px-3 py-2">
              {names.get(data.conflict.userId) ?? "Another member"} {data.conflict.what}. Check with them before you reach out.
            </p>
          )}
          {!can.ok && <Badge variant="destructive">{can.reason}</Badge>}
          {data.drafts.length > 0 && (
            <ul className="space-y-1.5 pt-1">
              {data.drafts.map((d) => (
                <li key={d.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-muted-foreground">Draft: </span>
                    {d.subject || "(no subject)"}
                  </span>
                  <OpenDraftButton orgId={orgId} draftId={d.id} />
                </li>
              ))}
            </ul>
          )}
          {mail.sent > 0 && (
            <p className="text-muted-foreground">
              {mail.sent} sent: {mail.replied} replied, {mail.clicked} clicked{mail.bounced ? `, ${mail.bounced} bounced` : ""}. About {mail.opened} opened (opens are approximate).
            </p>
          )}
        </div>
        <PersonOutreachControls
          orgId={orgId}
          person={{ id: p.id, name: p.name, email: p.primaryEmail, phone: p.phone, blocked: can.ok ? null : can.reason }}
          cadence={p.keepInTouchDays}
          enrollments={data.enrollments.map((e) => ({ id: e.id, name: e.sequence.name, status: e.status, step: e.nextStep }))}
          sequences={data.sequences}
          invites={data.invites}
          templates={data.templates}
          selfUpdateUrl={data.selfUpdate}
        />
      </Section>
      {(giving.gifts.length > 0 || giving.volunteer.events > 0) && (
        <Section title="Giving and time">
          <dl className="grid grid-cols-2 gap-2 text-sm">
            {giving.totalCents > 0 && (
              <div>
                <dt className="text-muted-foreground text-xs">Given in all</dt>
                <dd className="font-semibold tabular-nums">{formatMoney(giving.totalCents)}</dd>
              </div>
            )}
            {giving.recurring && (
              <div>
                <dt className="text-muted-foreground text-xs">Recurring</dt>
                <dd className="font-semibold tabular-nums">
                  {formatMoney(giving.recurring.amountCents)} every {giving.recurring.every}
                </dd>
              </div>
            )}
            {giving.volunteer.events > 0 && (
              <div>
                <dt className="text-muted-foreground text-xs">Time at events</dt>
                <dd className="font-semibold tabular-nums">
                  {giving.volunteer.hours} hours, {giving.volunteer.events} events
                </dd>
              </div>
            )}
          </dl>
          {giving.gifts.length > 0 && (
            <ul className="space-y-1 text-sm">
              {giving.gifts.slice(0, 6).map((g, i) => (
                <li key={i} className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate">{g.what}</span>
                  <span className="text-muted-foreground text-xs">{g.at.toLocaleDateString("en-US", { month: "short", year: "numeric" })}</span>
                  <span className="tabular-nums">{formatMoney(g.amountCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
    </>
  );
}
