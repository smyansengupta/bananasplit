import { randomUUID } from "node:crypto";

import type { NotificationType } from "@/generated/prisma/client";
import { formatMoney } from "@/lib/crm/fields";
import { crmBase, crmRecordHref, type CrmTargetKind } from "@/lib/crm/href";
import { hrefWithOpen } from "@/lib/crm/overlay";
import { withSystemOrgTx, type TxClient } from "@/server/db/context";
import { notifyUsers } from "@/server/notifications";

import { inboxMayWant, type CrmEventPayload } from "./events";
import { effectiveOwnerId, rolePositions, type RoleOwner } from "./owners";

/**
 * The CRM in the Inbox (docs/features/crm.md, "The CRM in the Inbox").
 * Whatever comes into the CRM for someone lands in their Inbox's Updates:
 * someone new from anywhere (a form, a booking, an email, the API, a member
 * adding them for you, a new member joining), an import as one line, a
 * reply, a booking, a deal won or lost or given to you, a quote opened or
 * answered, a draft waiting for your OK, sending paused and what an
 * automation held back. Each links to the card (?open=, src/lib/crm/href.ts).
 *
 * Who: the record's owner (the member, or whoever holds its org-chart
 * position), else the CRM's managers (owners, admins and CRM managers; in a
 * Personal space that's its one member). Never the member who did it.
 *
 * Bursts are one row: a second item of the same group for the same member
 * within BURST_MS, while the first is still unread, rewrites that row
 * ("5 new people", latest name below) instead of adding one. Rewriting
 * needs the service path (jobs, public pages, webhooks); a member's own
 * action can't rewrite another member's row, so there it adds one. The
 * notify-email job still decides from each member's preferences whether
 * the first row of a burst is emailed too (CRM_NEW is off until asked).
 *
 * Record events reach here through the crm-event job (events.ts enqueues
 * one for anything worth an Inbox line), so a member's save never waits on
 * it and a rolled-back save tells nobody.
 */

export const BURST_MS = 30 * 60_000;
/** Something already said about this record to this member this recently isn't said again. */
const TOLD_MS = 10 * 60_000;

export type CrmInboxGroup =
  | "new-person"
  | "new-company"
  | "new-deal"
  | "own-person"
  | "own-company"
  | "own-deal"
  | "closed"
  | "form"
  | "member"
  | "import"
  | "booked"
  | "quote"
  | "approve"
  | "held";

export interface CrmInboxItem {
  type: NotificationType;
  group: CrmInboxGroup;
  title: string;
  body?: string | null;
  linkUrl: string | null;
  /** The record it's about: one already mentioned to them in the last few minutes isn't again. */
  recordId?: string | null;
  /** When several of this group arrive together: the row's words and link. */
  many?: (n: number) => { title: string; linkUrl: string | null };
  /** The line under a grouped row (defaults to the single title). */
  latest?: string;
  actorId?: string | null;
  /** The event's own id, so the same event twice is one row. */
  key?: string;
}

type Db = Pick<TxClient, "notification" | "membership" | "$queryRaw" | "crmSettings">;

/** Only the service path may rewrite a row (a member's grant is readAt alone). */
async function canRewrite(db: Db): Promise<boolean> {
  const [row] = await db.$queryRaw<{ who: string }[]>`SELECT current_user::text AS who`;
  return row?.who !== "app_user";
}

/** Puts one item in each member's Inbox, folding bursts into one row. */
export async function crmInbox(
  db: Db,
  organizationId: string,
  userIds: readonly (string | null | undefined)[],
  item: CrmInboxItem,
  now: Date = new Date(),
): Promise<void> {
  const recipients = [...new Set(userIds.filter((u): u is string => Boolean(u)))];
  if (recipients.length === 0) return;
  const rewrite = await canRewrite(db);
  const key = (item.key ?? randomUUID()).replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 120);
  for (const userId of recipients) {
    if (rewrite && item.recordId) {
      const told = await db.notification.findFirst({
        where: {
          organizationId,
          userId,
          createdAt: { gte: new Date(now.getTime() - TOLD_MS) },
          linkUrl: { contains: item.recordId },
        },
        select: { id: true },
      });
      if (told) continue;
    }
    if (rewrite && item.many) {
      const prior = await db.notification.findFirst({
        where: {
          organizationId,
          userId,
          readAt: null,
          createdAt: { gte: new Date(now.getTime() - BURST_MS) },
          dedupeKey: { startsWith: `crmg:${item.group}:` },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, dedupeKey: true },
      });
      if (prior?.dedupeKey) {
        const [, , count, ...rest] = prior.dedupeKey.split(":");
        const first = rest.join(":");
        if (first === key) continue; // the same event again
        const n = (Number(count) || 1) + 1;
        const words = item.many(n);
        await db.notification.update({
          where: { id: prior.id },
          data: {
            type: item.type,
            title: words.title.slice(0, 300),
            body: (item.latest ?? item.title).slice(0, 2000),
            linkUrl: words.linkUrl,
            dedupeKey: `crmg:${item.group}:${n}:${first}`,
            actorId: null,
            createdAt: now,
          },
        });
        continue;
      }
    }
    await notifyUsers(db, organizationId, [userId], {
      type: item.type,
      title: item.title,
      body: item.body ?? null,
      linkUrl: item.linkUrl,
      actorId: item.actorId ?? null,
      dedupeKey: `crmg:${item.group}:1:${key}`,
    });
  }
}

// ---- Who hears about it --------------------------------------------------------------------

/** Owners, admins and the CRM's managers (in a Personal space: its member). */
export async function crmManagers(db: Pick<TxClient, "membership" | "crmSettings">, organizationId: string): Promise<string[]> {
  const s = await db.crmSettings.findUnique({ where: { organizationId }, select: { managerIds: true } });
  const admins = await db.membership.findMany({
    where: { organizationId, role: { in: ["OWNER", "ADMIN"] } },
    select: { userId: true },
  });
  const members = new Set(
    (await db.membership.findMany({ where: { organizationId }, select: { userId: true } })).map((m) => m.userId),
  );
  return [...new Set([...admins.map((a) => a.userId), ...(s?.managerIds ?? [])])].filter((id) => members.has(id));
}

/** The record's owner when there is one (and they're still a member), else the managers. */
export async function ownerOrManagers(
  db: Pick<TxClient, "membership" | "crmSettings">,
  organizationId: string,
  record: { ownerId: string | null; ownerRoleKey: string | null },
  roles: ReadonlyMap<string, RoleOwner>,
): Promise<string[]> {
  const owner = effectiveOwnerId(record, roles);
  if (owner) {
    const m = await db.membership.findUnique({
      where: { userId_organizationId: { userId: owner, organizationId } },
      select: { userId: true },
    });
    if (m) return [m.userId];
  }
  return crmManagers(db, organizationId);
}

async function orgSlug(db: Pick<TxClient, "organization">, organizationId: string): Promise<string | null> {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { slug: true } });
  return org?.slug ?? null;
}

async function memberName(db: Pick<TxClient, "user">, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const u = await db.user.findUnique({ where: { id: userId }, select: { name: true } });
  return u?.name ?? null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Where someone new came from, in a few words. */
function fromWhere(source: string | null, detail: string | null, by: string | null): string {
  if (by) return `Added for you by ${by}`;
  switch (source) {
    case "form":
      return detail ? `From the form ${detail}` : "From a form";
    case "booking":
      return detail ? `Booked ${detail}` : "From your booking page";
    case "email":
    case "gmail":
    case "outlook":
      return "From an email";
    case "api":
      return "Through the API";
    case "text":
      return "From a text";
    case "members":
      return "A member of the organization";
    default:
      return detail ? `From ${detail}` : "New in the CRM";
  }
}

// ---- Record events (the crm-event job) -------------------------------------------------------

interface Loaded {
  kind: CrmTargetKind;
  id: string;
  name: string;
  ownerId: string | null;
  ownerRoleKey: string | null;
  source: string | null;
  sourceDetail: string | null;
  stage?: { kind: string; name: string } | null;
  amount?: string | null;
  closeReason?: string | null;
}

async function loadRecord(db: TxClient, organizationId: string, kind: CrmTargetKind, id: string): Promise<Loaded | null> {
  if (kind === "person") {
    const p = await db.crmPerson.findFirst({
      where: { id, organizationId, deletedAt: null },
      select: { name: true, ownerId: true, ownerRoleKey: true, source: true, sourceDetail: true },
    });
    return p ? { kind, id, ...p } : null;
  }
  if (kind === "company") {
    const c = await db.crmCompany.findFirst({
      where: { id, organizationId, deletedAt: null },
      select: { name: true, ownerId: true, ownerRoleKey: true },
    });
    return c ? { kind, id, ...c, source: null, sourceDetail: null } : null;
  }
  const d = await db.crmDeal.findFirst({
    where: { id, organizationId, deletedAt: null },
    select: {
      title: true,
      ownerId: true,
      ownerRoleKey: true,
      source: true,
      amountCents: true,
      currency: true,
      closeReason: true,
      stage: { select: { kind: true, name: true } },
    },
  });
  if (!d) return null;
  return {
    kind,
    id,
    name: d.title,
    ownerId: d.ownerId,
    ownerRoleKey: d.ownerRoleKey,
    source: d.source,
    sourceDetail: null,
    stage: d.stage,
    amount: d.amountCents ? formatMoney(d.amountCents, d.currency) : null,
    closeReason: d.closeReason,
  };
}

const NEW_GROUP = { person: "new-person", company: "new-company", deal: "new-deal" } as const;
const OWN_GROUP = { person: "own-person", company: "own-company", deal: "own-deal" } as const;
const WORD = { person: ["person", "people"], company: ["company", "companies"], deal: ["deal", "deals"] } as const;

/** The crm-event listener: turns record events into Inbox lines. */
export async function inboxListener(organizationId: string, event: CrmEventPayload, meta: { jobKey: string }): Promise<void> {
  if (!inboxMayWant(event)) return;
  const roles = await rolePositions(organizationId);
  await withSystemOrgTx(organizationId, async ({ db }) => {
    const crm = await db.crmSettings.findUnique({ where: { organizationId }, select: { setupDoneAt: true } });
    if (!crm?.setupDoneAt) return;
    const slug = await orgSlug(db, organizationId);
    if (!slug) return;
    const rec = await loadRecord(db, organizationId, event.targetKind, event.targetId);
    if (!rec) return;
    // A member's own change is never news to them; anything else (a form, a
    // booking, an automation, the API) is news to everyone it's for.
    const byMember = (event.source === null || event.source === "user" || event.source === "ai") && event.userId;
    const actorId = byMember ? event.userId : null;
    const actor = await memberName(db, actorId);
    const link = crmRecordHref(slug, rec.kind, rec.id);
    const base = crmBase(slug);
    const listOf = (kind: CrmTargetKind) =>
      kind === "deal" ? `${base}/people?view=board` : kind === "company" ? `${base}/people?view=companies` : `${base}/people?list=new`;
    const to = (await ownerOrManagers(db, organizationId, rec, roles)).filter((u) => u !== actorId);
    if (to.length === 0) return;
    const key = meta.jobKey;

    if (event.type === "form.submitted") {
      const form = event.sourceId
        ? await db.formResponse.findFirst({
            where: { id: event.sourceId, organizationId },
            select: { form: { select: { title: true } } },
          })
        : null;
      await crmInbox(db, organizationId, to, {
        type: "CRM_NEW",
        group: "form",
        title: `${rec.name} answered ${form?.form.title ?? "a form"}`,
        body: rec.ownerId || rec.ownerRoleKey ? null : "Nobody looks after them yet",
        linkUrl: link,
        recordId: rec.id,
        many: (n) => ({ title: `${n} form answers from people in the CRM`, linkUrl: `${base}/people` }),
        latest: `Latest: ${rec.name}`,
        key,
      });
      return;
    }

    const fields = event.fields;
    const [one, many] = WORD[rec.kind];
    if (fields.includes("created")) {
      const unowned = !rec.ownerId && !rec.ownerRoleKey;
      const where = fromWhere(rec.source, rec.sourceDetail, actor);
      await crmInbox(db, organizationId, to, {
        type: rec.kind === "deal" ? "CRM_DEAL" : "CRM_NEW",
        group: NEW_GROUP[rec.kind],
        title: rec.kind === "deal" ? `New deal: ${rec.name}` : `New ${one}: ${rec.name}`,
        body: [where, rec.amount, unowned ? "Nobody looks after them yet" : null].filter(Boolean).join(". ") || null,
        linkUrl: link,
        recordId: rec.id,
        actorId,
        many: (n) => ({ title: `${n} new ${many} in the CRM`, linkUrl: listOf(rec.kind) }),
        latest: `Latest: ${rec.name}. ${where}`,
        key,
      });
      return;
    }
    if (fields.includes("ownerId") || fields.includes("ownerRoleKey")) {
      // Only the new owner hears it ("yours now"); taken off, nobody.
      const owner = effectiveOwnerId(rec, roles);
      if (!owner || owner === actorId || !to.includes(owner)) return;
      await crmInbox(db, organizationId, [owner], {
        type: rec.kind === "deal" ? "CRM_DEAL" : "CRM_ASSIGNED",
        group: OWN_GROUP[rec.kind],
        title: `${rec.name} is yours now`,
        body: actor ? `Given to you by ${actor}` : event.source === "automation" ? "Given to you by an automation" : null,
        linkUrl: link,
        recordId: rec.id,
        actorId,
        many: (n) => ({ title: `${n} ${many} are yours now`, linkUrl: listOf(rec.kind) }),
        latest: `Latest: ${rec.name}`,
        key,
      });
      return;
    }
    if (rec.kind === "deal" && fields.includes("stageId") && (rec.stage?.kind === "WON" || rec.stage?.kind === "LOST")) {
      const won = rec.stage.kind === "WON";
      await crmInbox(db, organizationId, to, {
        type: "CRM_DEAL",
        group: "closed",
        title: `${won ? "Won" : "Lost"}: ${rec.name}`,
        body:
          [rec.amount, won ? null : rec.closeReason, actor ? `${actor} moved it` : event.source === "system" ? "Moved on its own" : null]
            .filter(Boolean)
            .join(". ") || null,
        linkUrl: link,
        recordId: rec.id,
        actorId,
        many: (n) => ({ title: `${plural(n, "deal", "deals")} closed`, linkUrl: `${base}/people?view=board` }),
        latest: `Latest: ${won ? "won" : "lost"} ${rec.name}`,
        key,
      });
    }
  });
}

// ---- Called where things happen ------------------------------------------------------------------

/** A member joined the organization: the CRM's managers hear, with the person card when they're already in it. */
export async function crmMemberJoined(db: TxClient, organizationId: string, userId: string): Promise<void> {
  const crm = await db.crmSettings.findUnique({ where: { organizationId }, select: { setupDoneAt: true } });
  if (!crm?.setupDoneAt) return;
  const slug = await orgSlug(db, organizationId);
  const user = await db.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
  if (!slug || !user) return;
  const email = user.email?.trim().toLowerCase() ?? null;
  const linked = await db.crmPerson.findFirst({ where: { organizationId, userId, deletedAt: null }, select: { id: true } });
  const byEmail =
    !linked && email
      ? await db.crmPersonEmail.findFirst({
          where: { organizationId, email, person: { deletedAt: null } },
          select: { personId: true },
        })
      : null;
  const person = linked ?? (byEmail ? { id: byEmail.personId } : null);
  const name = user.name ?? user.email ?? "Someone";
  const base = crmBase(slug);
  await crmInbox(
    db,
    organizationId,
    (await crmManagers(db, organizationId)).filter((u) => u !== userId),
    {
      type: "CRM_NEW",
      group: "member",
      title: `New member: ${name}`,
      body: person ? "Already in the CRM" : "Not in the CRM yet. Add them from People",
      linkUrl: person ? crmRecordHref(slug, "person", person.id) : hrefWithOpen(`${base}/people`, "", "new:person"),
      recordId: person?.id ?? null,
      many: (n) => ({ title: `${n} new members`, linkUrl: `${base}/people` }),
      latest: `Latest: ${name}`,
      key: `member-${userId}`,
    },
  );
}

/** An import finished: one line for whoever started it. */
export async function crmImportDone(
  db: TxClient,
  organizationId: string,
  userId: string | null,
  input: { fileName: string; object: string; created: number; updated: number; skipped: number; importId: string },
): Promise<void> {
  if (!userId) return;
  const slug = await orgSlug(db, organizationId);
  if (!slug) return;
  const base = crmBase(slug);
  const words = input.object === "company" ? WORD.company : input.object === "deal" ? WORD.deal : WORD.person;
  await crmInbox(db, organizationId, [userId], {
    type: "CRM_NEW",
    group: "import",
    title: `${input.fileName} is in`,
    body: [
      input.created ? `${plural(input.created, words[0], words[1])} added` : null,
      input.updated ? `${input.updated} updated` : null,
      input.skipped ? `${input.skipped} to fix` : null,
    ]
      .filter(Boolean)
      .join(", ") || "Nothing new in it",
    linkUrl: input.skipped
      ? `${base}/settings/import`
      : input.object === "deal"
        ? `${base}/people?view=board`
        : input.object === "company"
          ? `${base}/people?view=companies`
          : `${base}/people?list=new`,
    key: `import-${input.importId}`,
  });
}

/** Several records given to one member in one go (People's Change owner): one line. */
export async function crmGivenInBulk(
  db: TxClient,
  organizationId: string,
  input: { to: string; byUserId: string; kind: CrmTargetKind; count: number; batchId: string },
): Promise<void> {
  if (input.count === 0 || input.to === input.byUserId) return;
  const slug = await orgSlug(db, organizationId);
  if (!slug) return;
  const by = await memberName(db, input.byUserId);
  const [one, many] = WORD[input.kind];
  const base = crmBase(slug);
  await crmInbox(db, organizationId, [input.to], {
    type: input.kind === "deal" ? "CRM_DEAL" : "CRM_ASSIGNED",
    group: OWN_GROUP[input.kind],
    title: `${plural(input.count, one, many)} ${input.count === 1 ? "is" : "are"} yours now`,
    body: by ? `Given to you by ${by}` : null,
    linkUrl: input.kind === "deal" ? `${base}/people?view=board` : `${base}/people`,
    actorId: input.byUserId,
    key: input.batchId,
  });
}

/** A quote or invoice was opened, accepted or declined by the person it went to. */
export async function crmQuoteEvent(
  db: TxClient,
  organizationId: string,
  q: { id: string; number: string; kind: string; dealId: string | null; personId: string | null; createdById: string | null },
  what: "opened" | "accepted" | "declined",
  by?: string | null,
): Promise<void> {
  const slug = await orgSlug(db, organizationId);
  if (!slug) return;
  const deal = q.dealId
    ? await db.crmDeal.findFirst({ where: { id: q.dealId, organizationId }, select: { title: true, ownerId: true, ownerRoleKey: true } })
    : null;
  const roles = await rolePositions(organizationId);
  let to = deal ? await ownerOrManagers(db, organizationId, deal, roles) : [];
  if (!deal && q.createdById) to = [q.createdById];
  if (to.length === 0) to = await crmManagers(db, organizationId);
  const word = q.kind === "invoice" ? "Invoice" : "Quote";
  const link = q.dealId
    ? crmRecordHref(slug, "deal", q.dealId)
    : q.personId
      ? crmRecordHref(slug, "person", q.personId)
      : `${crmBase(slug)}/people?view=board`;
  await crmInbox(db, organizationId, to, {
    type: "CRM_DEAL",
    group: "quote",
    title:
      what === "opened"
        ? `${word} ${q.number} was opened`
        : what === "accepted"
          ? `${word} ${q.number} was accepted${by ? ` by ${by}` : ""}`
          : `${word} ${q.number} was declined`,
    body: deal?.title ?? null,
    linkUrl: link,
    // Opened once is enough: the same quote opened again says nothing.
    key: `quote-${q.id}-${what}`,
  });
}

/** Where a draft or change waiting for someone's OK opens: Today's To approve, with its card. */
export function approveHref(slug: string, target: { kind: string; id: string } | null): string {
  const base = crmBase(slug);
  if (target && (target.kind === "person" || target.kind === "company" || target.kind === "deal")) {
    return hrefWithOpen(base, "show=approve", { kind: target.kind, id: target.id });
  }
  return `${base}?show=approve`;
}

/** A draft or change now waits for this member's OK (proposeChange). */
export async function crmToApprove(
  db: TxClient,
  organizationId: string,
  input: { userId: string; title: string; summary: string | null; target: { kind: string; id: string } | null; actorId: string | null; suggestionId: string },
): Promise<void> {
  const slug = await orgSlug(db, organizationId);
  if (!slug) return;
  await crmInbox(db, organizationId, [input.userId], {
    type: "CRM_REVIEW",
    group: "approve",
    title: input.title.slice(0, 200),
    body: input.summary ?? "Waiting for your OK in the CRM.",
    linkUrl: approveHref(slug, input.target),
    actorId: input.actorId,
    many: (n) => ({ title: `${n} drafts and changes wait for your OK`, linkUrl: `${crmBase(slug)}?show=approve` }),
    latest: `Latest: ${input.title.slice(0, 200)}`,
    key: `review-${input.suggestionId}`,
  });
}

/** What the CRM held back or couldn't do on its own (Done on its own lists the rest). */
export async function crmHeldBack(
  db: TxClient,
  organizationId: string,
  userIds: readonly (string | null)[],
  input: { title: string; why: string | null; key: string; personId?: string | null },
): Promise<void> {
  const slug = await orgSlug(db, organizationId);
  if (!slug) return;
  const base = crmBase(slug);
  await crmInbox(db, organizationId, userIds, {
    type: "CRM_REVIEW",
    group: "held",
    title: input.title.slice(0, 200),
    body: input.why,
    linkUrl: hrefWithOpen(base, "", "log"),
    many: (n) => ({ title: `${n} things the CRM held back`, linkUrl: hrefWithOpen(base, "", "log") }),
    latest: `Latest: ${input.title.slice(0, 200)}`,
    key: input.key,
  });
}

/** Sending stopped for everyone (the spending cap, no sender): once a day to the sender and the managers. */
export async function crmSendingPaused(db: TxClient, organizationId: string, senderId: string | null, why: string): Promise<void> {
  const slug = await orgSlug(db, organizationId);
  if (!slug) return;
  const day = new Date().toISOString().slice(0, 10);
  await notifyUsers(db, organizationId, [...new Set([senderId, ...(await crmManagers(db, organizationId))].filter((u): u is string => Boolean(u)))], {
    type: "CRM_REVIEW",
    title: "Sending is paused",
    body: why.replace(/\.?$/, "."),
    linkUrl: `${crmBase(slug)}/settings/sending`,
    dedupeKey: `crm-paused:${day}`,
  });
}
