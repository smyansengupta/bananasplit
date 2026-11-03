import { NewPlanCard } from "@/components/crm/cards/new-plan-card";
import {
  PlanCard,
  type CampaignPlanData,
  type PlanReply,
  type SequencePlanData,
} from "@/components/crm/cards/plan-card";
import {
  audienceChips,
  audienceOffers,
  campaignPlanStatus,
  funnel,
  readExtras,
  sequencePlanStatus,
} from "@/lib/crm/outreach/plans";
import { readWindow, windowLabel } from "@/lib/crm/outreach/schedule";
import { effectiveTimezone } from "@/lib/tasks/dates";
import { campaignProgress, inviteLink, myShare } from "@/server/crm/outreach/campaigns";
import { listsWithCounts, listPeople } from "@/server/crm/outreach/lists";
import { checkSender } from "@/server/crm/outreach/mailbox";
import { audienceRows, listAudience } from "@/server/crm/outreach/plans";
import { composeTemplates } from "@/server/crm/outreach/view";
import type { TxClient } from "@/server/db/context";
import { withOrgTx } from "@/server/db/context";

import type { OverlayProps } from "./crm-overlays";

const DAY = 86_400_000;

function when(d: Date, now: Date, tz: string): string {
  const days = Math.floor((now.getTime() - d.getTime()) / DAY);
  if (days < 1) {
    return `Today, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz })}`;
  }
  if (days < 2) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: tz });
}

function nextLabel(at: Date, now: Date, tz: string): string {
  const time = at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
  const days = Math.round((at.getTime() - now.getTime()) / DAY);
  if (at.getTime() <= now.getTime() + 60_000) return "Next sends now";
  if (days < 1) return `Next sends today at ${time}`;
  if (days < 2) return `Next sends tomorrow at ${time}`;
  return `Next sends ${at.toLocaleDateString("en-US", { weekday: "long", timeZone: tz })} at ${time}`;
}

/** The latest message each person sent us, whether anyone answered it. */
async function repliesOf(
  db: TxClient,
  orgId: string,
  people: readonly { personId: string; name: string }[],
  since: Date,
  now: Date,
  tz: string,
): Promise<PlanReply[]> {
  const out: PlanReply[] = [];
  for (const p of people.slice(0, 30)) {
    const inbound = await db.crmEmailMessage.findFirst({
      where: {
        organizationId: orgId,
        personId: p.personId,
        direction: "INBOUND",
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      select: { threadId: true, createdAt: true, bodyText: true, subject: true },
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
      : 1;
    out.push({
      personId: p.personId,
      name: p.name,
      when: inbound ? when(inbound.createdAt, now, tz) : "",
      text: inbound
        ? (inbound.bodyText ?? inbound.subject ?? "").replace(/\s+/g, " ").trim().slice(0, 200)
        : "",
      why:
        inbound && !answered
          ? `Wrote back ${when(inbound.createdAt, now, tz).toLowerCase()}, nobody has answered`
          : null,
    });
  }
  return out;
}

/** An outreach plan's card (?open=plan:...): a sequence or a campaign, or a new one-email or split plan. */
export async function PlanOverlay({ shell, orgSlug, open }: OverlayProps<"plan">) {
  const orgId = shell.org.id;
  const viewerId = shell.user.id;
  const now = new Date();
  const members = new Map(shell.members.map((m) => [m.id, m.name]));
  const relTypes = shell.access.settings?.relationshipTypes ?? [];
  const relationships = new Map(relTypes.map((t) => [t.id, t.label]));
  const me = members.get(viewerId) ?? "You";

  if (open.id === null) {
    const sender =
      open.type === "email"
        ? await checkSender(orgId).catch(() => ({
            ok: false,
            from: null,
            domain: null,
            problem: "We couldn't check your sender just now.",
          }))
        : null;
    const data = await withOrgTx(orgId, async ({ db }) => ({
      lists: await listsWithCounts(db, orgId, viewerId, shell.roles),
      templates: await composeTemplates(db, orgId),
      sequences: await db.crmSequence.findMany({
        where: { organizationId: orgId, archivedAt: null, status: "ON" },
        select: { id: true, name: true },
        take: 50,
      }),
      events: (
        await db.event.findMany({
          where: {
            organizationId: orgId,
            deletedAt: null,
            rsvpEnabled: true,
            startsAt: { gte: now },
          },
          orderBy: { startsAt: "asc" },
          take: 20,
          select: { id: true, title: true },
        })
      ).map((e) => ({ id: e.id, name: e.title })),
      forms: (
        await db.form.findMany({
          where: {
            organizationId: orgId,
            deletedAt: null,
            publishedAt: { not: null },
            closedAt: null,
          },
          orderBy: { updatedAt: "desc" },
          take: 20,
          select: { id: true, title: true },
        })
      ).map((f) => ({ id: f.id, name: f.title })),
    }));
    return (
      <NewPlanCard
        orgId={orgId}
        what={open.type}
        lists={data.lists.map((l) => ({
          id: l.id,
          name: l.name,
          count: l.count,
          emailable: l.emailable,
        }))}
        templates={data.templates}
        sequences={data.sequences}
        events={data.events}
        forms={data.forms}
        members={shell.members}
        userId={viewerId}
        orgSlug={orgSlug}
        sender={sender}
        canSend={shell.access.manager}
      />
    );
  }

  if (open.type === "sequence") {
    const data = await withOrgTx(orgId, async ({ db }) => {
      const seq = await db.crmSequence.findFirst({
        where: { id: open.id, organizationId: orgId, archivedAt: null },
        include: { steps: { orderBy: { sortOrder: "asc" } } },
      });
      if (!seq) return null;
      const u = await db.user.findUnique({ where: { id: viewerId }, select: { timezone: true } });
      const tz = effectiveTimezone(u, shell.org);
      const extras = readExtras(seq.sendWindow);
      const rows = await audienceRows(db, orgId, seq.id, extras, viewerId, shell.roles);
      const enrollments = await db.crmEnrollment.findMany({
        where: { organizationId: orgId, sequenceId: seq.id },
        select: {
          id: true,
          personId: true,
          status: true,
          nextRunAt: true,
          startedAt: true,
          person: { select: { name: true } },
        },
        take: 5000,
      });
      const ids = enrollments.map((e) => e.id);
      const sent = ids.length
        ? await db.crmEmailMessage.count({
            where: { organizationId: orgId, enrollmentId: { in: ids }, status: "SENT" },
          })
        : 0;
      const opened = ids.length
        ? await db.crmEmailMessage.count({
            where: { organizationId: orgId, enrollmentId: { in: ids }, openCount: { gt: 0 } },
          })
        : 0;
      const repliedPeople = enrollments.filter(
        (e) => e.status === "REPLIED" || e.status === "BOOKED",
      );
      const first = enrollments.reduce<Date | null>(
        (a, e) => (!a || e.startedAt < a ? e.startedAt : a),
        null,
      );
      const next = enrollments
        .filter((e) => e.status === "ACTIVE" && e.nextRunAt)
        .reduce<Date | null>((a, e) => (!a || e.nextRunAt! < a ? e.nextRunAt! : a), null);
      const replies = await repliesOf(
        db,
        orgId,
        repliedPeople.map((e) => ({ personId: e.personId, name: e.person.name })),
        first ?? seq.createdAt,
        now,
        tz,
      );
      const settings = await db.crmSettings.findUnique({
        where: { organizationId: orgId },
        select: { dailySendCap: true },
      });
      return {
        seq,
        tz,
        extras,
        rows,
        enrollments,
        sent,
        opened,
        replies,
        first,
        next,
        orgCap: settings?.dailySendCap ?? 150,
        templates: await composeTemplates(db, orgId),
      };
    });
    if (!data) return <PlanCard orgId={orgId} data={null} />;
    const { seq, extras, rows, tz } = data;
    const status = sequencePlanStatus(seq.status);
    const inIt = data.enrollments.filter(
      (e) => e.status === "ACTIVE" || e.status === "PAUSED",
    ).length;
    const counted = rows.filter((r) => !r.why);
    const statusText =
      status === "running"
        ? `Running${data.first ? ` since ${data.first.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: tz })}` : ""}. ${data.next ? `${nextLabel(data.next, now, tz)}.` : "Nothing waiting to send."}`
        : status === "paused"
          ? "Paused. Nobody gets the next step until you start it."
          : "Draft. Nothing goes out until you start it.";
    const card: SequencePlanData = {
      type: "sequence",
      id: seq.id,
      name: seq.name,
      status,
      statusText,
      steps: seq.steps.map((s) => ({
        kind: s.kind,
        delayDays: s.delayDays,
        delayHours: s.delayHours,
        subject: s.subject,
        body: s.body,
        templateId: s.templateId,
        taskTitle: s.taskTitle,
      })),
      templates: data.templates.map((t) => ({ id: t.id, name: t.name })),
      stopOnReply: seq.stopOnReply,
      window: windowLabel(readWindow(seq.sendWindow)),
      extras,
      orgCap: data.orgCap,
      me,
      orgName: shell.org.name,
      who: {
        set:
          rows.length > 0 || Boolean(extras.who.relationship || extras.who.owner || extras.who.due),
        chips: audienceChips(extras.who, { relationships, members }),
        offers: audienceOffers(
          extras.who,
          relTypes.map((t) => ({ id: t.id, label: t.label })),
        ),
        count: counted.length,
        inIt,
        sample: counted.slice(0, 3).map((r) => ({ id: r.personId, name: r.name })),
        excluded: rows
          .filter((r) => r.why)
          .slice(0, 40)
          .map((r) => ({
            personId: r.personId,
            name: r.name,
            why: r.why!,
            canInclude: r.canInclude,
          })),
        excludedCount: rows.filter((r) => r.why).length,
        include: extras.include,
      },
      results: {
        bars: funnel([
          { label: "Sent", n: data.sent },
          { label: "Opened", n: data.opened },
          { label: "Replied", n: data.replies.length },
        ]),
        replies: data.replies,
        since: data.first
          ? data.first.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: tz })
          : null,
        next: data.next && status === "running" ? nextLabel(data.next, now, tz) : null,
      },
    };
    return <PlanCard orgId={orgId} data={card} />;
  }

  // A campaign: a list split among members, or one email to everyone on it.
  const data = await withOrgTx(orgId, async ({ db }) => {
    const c = await db.crmCampaign.findFirst({ where: { id: open.id, organizationId: orgId } });
    if (!c || c.status === "ARCHIVED") return null;
    const u = await db.user.findUnique({ where: { id: viewerId }, select: { timezone: true } });
    const tz = effectiveTimezone(u, shell.org);
    const view = c.viewId
      ? await db.crmView.findFirst({
          where: { id: c.viewId, organizationId: orgId },
          select: { name: true, filters: true },
        })
      : null;
    const progress = await campaignProgress(db, orgId, c.id);
    const rows = await myShare(db, orgId, c.id, viewerId, true);
    const bulk = c.channel === "bulk";
    let message: { subject: string; body: string } | null = null;
    let steps: CampaignPlanData["steps"] = [];
    if (bulk) {
      const m = await db.crmEmailMessage.findFirst({
        where: { organizationId: orgId, campaignId: c.id },
        orderBy: { createdAt: "asc" },
        select: { subject: true, bodyText: true },
      });
      steps = [
        {
          kind: "email",
          title: "One email to everyone",
          subject: m?.subject ?? null,
          body: m?.bodyText ?? null,
          note: null,
        },
      ];
    } else if (c.sequenceId) {
      const s = await db.crmSequence.findFirst({
        where: { id: c.sequenceId, organizationId: orgId },
        select: {
          name: true,
          steps: {
            orderBy: { sortOrder: "asc" },
            select: { kind: true, delayDays: true, subject: true, body: true, taskTitle: true },
          },
        },
      });
      steps = (s?.steps ?? []).map((st) => ({
        kind:
          st.kind === "EMAIL"
            ? "email"
            : st.kind === "TEXT"
              ? "text"
              : st.kind === "CALL"
                ? "call"
                : "task",
        title: `${st.kind === "EMAIL" ? "Email" : st.kind === "TEXT" ? "Text" : st.kind === "CALL" ? "Call" : (st.taskTitle ?? "Task")}${st.delayDays ? `, after ${st.delayDays} ${st.delayDays === 1 ? "day" : "days"}` : ""}`,
        subject: st.subject,
        body: st.body,
        note: null,
      }));
    } else {
      const template = c.templateId
        ? await db.crmTemplate.findFirst({
            where: { id: c.templateId, organizationId: orgId },
            select: { subject: true, body: true },
          })
        : null;
      const link = await inviteLink(db, orgId, c.channel, c.eventId);
      const event = c.eventId
        ? await db.event.findFirst({
            where: { id: c.eventId, organizationId: orgId },
            select: { title: true },
          })
        : null;
      message = template ? { subject: template.subject ?? c.name, body: template.body } : null;
      if (link) {
        message = {
          subject: message?.subject ?? (event ? `Come to ${event.title}` : c.name),
          body: `${message?.body ?? `Hi {{first_name|there}},\n\nWe'd love you to ${event ? `come to ${event.title}` : "fill this in"}.`}\n\n${link}\n\n{{my_first_name}}`,
        };
      }
      steps =
        c.channel === "call"
          ? [
              {
                kind: "call",
                title: "Each member calls their share",
                subject: null,
                body: null,
                note: "Log each call from the person's card; it counts as reached.",
              },
            ]
          : [
              {
                kind: "email",
                title: "Each member sends from their own mailbox",
                subject: message?.subject ?? null,
                body: message?.body ?? null,
                note: null,
              },
            ];
    }
    let newOnList = 0;
    if (c.viewId && !bulk) {
      const people = await listPeople(db, orgId, c.viewId, viewerId, shell.roles, 2000).catch(
        () => [],
      );
      const have = new Set(rows.map((r) => r.person.id));
      newOnList = people.filter((p) => !have.has(p.id)).length;
    }
    let bars;
    if (bulk) {
      const n = (where: object) =>
        db.crmEmailMessage.count({ where: { organizationId: orgId, campaignId: c.id, ...where } });
      bars = funnel([
        { label: "Sent", n: await n({ status: "SENT" }) },
        { label: "Opened", n: await n({ openCount: { gt: 0 } }) },
        { label: "Replied", n: await n({ repliedAt: { not: null } }) },
      ]);
    } else {
      bars = funnel([
        { label: "People", n: progress.total },
        { label: "Reached", n: progress.contacted },
        { label: "Replied", n: progress.replied },
        { label: "Booked", n: progress.booked },
      ]);
    }
    const replied = rows
      .filter(
        (r) =>
          r.status === "REPLIED" ||
          r.status === "BOOKED" ||
          r.status === "CONVERTED" ||
          r.repliedAt,
      )
      .map((r) => ({ personId: r.person.id, name: r.person.name }));
    const replies = await repliesOf(db, orgId, replied, c.createdAt, now, tz);
    return { c, tz, view, progress, rows, message, steps, newOnList, bars, replies };
  });
  if (!data) return <PlanCard orgId={orgId} data={null} />;
  const { c, tz } = data;
  const status = campaignPlanStatus(c.status);
  const due = c.dueOn
    ? c.dueOn.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })
    : null;
  const bulk = c.channel === "bulk";
  const card: CampaignPlanData = {
    type: "campaign",
    id: c.id,
    name: c.name,
    status,
    shape: bulk ? "email" : "split",
    channel: c.channel,
    statusText: bulk
      ? `Sent ${c.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: tz })} from the organization.`
      : status === "running"
        ? `Running${due ? `, due ${due}` : ""}. ${data.progress.contacted} of ${data.progress.total} reached.`
        : "Done. Run it again to keep working the list.",
    goal: c.goal,
    due,
    sequenceId: c.sequenceId,
    steps: data.steps,
    message: data.message,
    who: {
      listName: data.view?.name ?? null,
      chips: data.view
        ? audienceChips(listAudience(data.view.filters), { relationships, members })
        : [],
      count: data.progress.total,
      newOnList: data.newOnList,
      byMember: data.progress.byMember.map((m) => ({
        name: m.userId ? (members.get(m.userId) ?? "A former member") : "Nobody",
        total: m.total,
        contacted: m.contacted,
        replied: m.replied,
      })),
      rows: data.rows.map((r) => ({
        id: r.id,
        personId: r.person.id,
        name: r.person.name,
        sub: [r.person.title, r.person.company?.name].filter(Boolean).join(", ") || null,
        email: r.person.primaryEmail,
        phone: r.person.phone,
        status: r.status,
        assigneeId: r.assigneeId,
        blocked: r.blocked,
      })),
    },
    results: {
      bars: data.bars,
      replies: data.replies,
      since: c.createdAt.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: tz,
      }),
      next: null,
    },
    members: shell.members,
    userId: viewerId,
  };
  return <PlanCard orgId={orgId} data={card} />;
}
