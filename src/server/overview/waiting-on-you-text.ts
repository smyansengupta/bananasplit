import type { ItemRef } from "@/components/overview/connections";
import type { PersonFace } from "@/server/overview/queries";

import { daysAgoWord, dollars, firstName, money, plural } from "./text";

/**
 * Waiting on you: the Inbox's needs-you items (reimbursements to decide,
 * form responses to review, mentions to answer, invites to answer) as
 * rows that say what each one unblocks, and the one line about what
 * approving does to the budget. Pure; the loader gathers WaitingFacts.
 */

interface Named {
  id: string;
  title: string;
}

export interface WaitingFacts {
  base: string;
  now: Date;
  /** The viewer may decide reimbursements (and see the budget). */
  seesMoney: boolean;
  requests: {
    id: string;
    description: string;
    amountCents: number;
    createdAt: Date;
    submitter: PersonFace;
    receipts: number;
    /** The task it pays for, when one is set. */
    task: (Named & { status: string }) | null;
    event: Named | null;
    category: {
      id: string;
      name: string;
      periodId: string;
      /** The category's own budget period ("Fall 2026"), for the budget line. */
      periodLabel: string | null;
      allocatedCents: number;
      spentCents: number;
    } | null;
  }[];
  reviews: { id: string; title: string; count: number; event: Named | null }[];
  mentions: {
    /** The notification. */
    id: string;
    title: string;
    excerpt: string | null;
    href: string | null;
    actor: PersonFace | null;
    task: (Named & { status: string }) | null;
    event: Named | null;
  }[];
  invites: { id: string; title: string; when: string; host: PersonFace | null }[];
  /**
   * The CRM, when it's there for the viewer: people who wrote back to them
   * and nobody has answered, and what waits for their OK (drafts, changes,
   * new people), each with its place on the CRM's Today.
   */
  crm?: {
    replies: number;
    repliesHref: string;
    approve: number;
    approveHref: string;
  } | null;
}

export type WaitingKind = "request" | "review" | "mention" | "invite" | "crm";

export interface WaitingRow {
  /** The Inbox's key for it, so Snooze and Done there apply here too. */
  key: string;
  kind: WaitingKind;
  id: string;
  face: PersonFace | null;
  /** Shown in the face's place when there's no one person (2 responses). */
  count?: number;
  title: string;
  sub: string | null;
  href: string;
  /** A mention on a task: Reply comments there. */
  replyTaskId: string | null;
}

export interface InsightRun {
  text: string;
  bold?: boolean;
}

export interface WaitingOnYou {
  rows: WaitingRow[];
  chips: ItemRef[];
  insight: { runs: InsightRun[]; tone: "plain" | "warn" } | null;
}

const OPEN = new Set(["NOT_STARTED", "IN_PROGRESS", "BLOCKED"]);

/** "Unblocks Order pizza." when what it's for is still open. */
function unblocks(task: { title: string; status: string } | null): string | null {
  return task && OPEN.has(task.status) ? `Unblocks ${task.title}.` : null;
}

export function buildWaitingOnYou(f: WaitingFacts): WaitingOnYou {
  const rows: WaitingRow[] = [];
  const chips: ItemRef[] = [];
  const chip = (c: ItemRef) => {
    if (!chips.some((x) => x.href === c.href)) chips.push(c);
  };
  const event = (e: Named): ItemRef => ({
    kind: "event",
    label: e.title,
    href: `${f.base}/meetings/${e.id}`,
  });
  const task = (t: Named): ItemRef => ({
    kind: "task",
    label: t.title,
    href: `${f.base}/tasks/${t.id}`,
  });

  for (const r of f.requests) {
    const left = r.category ? r.category.allocatedCents - r.category.spentCents : null;
    const parts = [
      `${r.submitter.name ?? "A member"}, ${daysAgoWord(r.createdAt, f.now)}.`,
      r.receipts > 0 ? "Receipt attached." : "No receipt yet.",
      r.category && left !== null && left >= 0
        ? `${r.category.name} has ${dollars(left)} left.`
        : null,
      unblocks(r.task),
    ];
    rows.push({
      key: `request:${r.id}`,
      kind: "request",
      id: r.id,
      face: r.submitter,
      title: `${r.description}, ${money(r.amountCents)}`,
      sub: parts.filter(Boolean).join(" "),
      href: `${f.base}/finance/transactions?open=${r.id}`,
      replyTaskId: null,
    });
    if (r.category) {
      chip({
        kind: "money",
        label: `${r.category.name} budget`,
        href: `${f.base}/finance/budget?period=${r.category.periodId}`,
      });
    }
    if (r.task) chip(task(r.task));
    if (r.event) chip(event(r.event));
  }

  for (const v of f.reviews) {
    rows.push({
      key: `review:${v.id}`,
      kind: "review",
      id: v.id,
      face: null,
      count: v.count,
      title: `${v.title}: ${plural(v.count, "new response")}`,
      sub: v.event ? `For ${v.event.title}` : null,
      href: `${f.base}/forms/${v.id}?tab=responses&view=review`,
      replyTaskId: null,
    });
    chip({ kind: "form", label: v.title, href: `${f.base}/forms/${v.id}` });
    if (v.event) chip(event(v.event));
  }

  for (const m of f.mentions) {
    const blocked = m.task && m.task.status === "BLOCKED" ? `${m.task.title} is blocked.` : null;
    rows.push({
      key: `update:${m.id}`,
      kind: "mention",
      id: m.id,
      face: m.actor,
      title: m.title,
      sub: [m.excerpt ? `“${m.excerpt}”` : null, blocked].filter(Boolean).join(" ") || null,
      href: m.href ?? (m.task ? `${f.base}/tasks/${m.task.id}` : `${f.base}/inbox?view=updates`),
      replyTaskId: m.task?.id ?? null,
    });
    if (m.task) chip(task(m.task));
    if (m.event) chip(event(m.event));
  }

  for (const i of f.invites) {
    rows.push({
      key: `invite:${i.id}`,
      kind: "invite",
      id: i.id,
      face: i.host,
      title: i.title,
      sub: i.host ? `${firstName(i.host.name)} invited you, ${i.when}` : i.when,
      href: `${f.base}/meetings/${i.id}`,
      replyTaskId: null,
    });
    chip(event(i));
  }

  // The CRM's two counts, each a row that opens Today on its group.
  if (f.crm?.replies) {
    rows.push({
      key: "crm:replies",
      kind: "crm",
      id: "replies",
      face: null,
      count: f.crm.replies,
      title: f.crm.replies === 1 ? "1 reply waiting in the CRM" : `${f.crm.replies} replies waiting in the CRM`,
      sub: "They wrote back and nobody has answered yet.",
      href: f.crm.repliesHref,
      replyTaskId: null,
    });
  }
  if (f.crm?.approve) {
    rows.push({
      // The Inbox's key for the same row, so Snooze and Done there apply here.
      key: "crm:review",
      kind: "crm",
      id: "review",
      face: null,
      count: f.crm.approve,
      title: f.crm.approve === 1 ? "1 thing to approve in the CRM" : `${f.crm.approve} things to approve in the CRM`,
      sub: "Drafts, changes and new people waiting for your OK.",
      href: f.crm.approveHref,
      replyTaskId: null,
    });
  }

  return { rows, chips, insight: f.seesMoney ? budgetInsight(f) : null };
}

/**
 * What approving does: the task a request unblocks, and what the requests
 * leave in their budget category (the category with the most waiting).
 * Waiting requests already count as spent in Finance, so "leave" is the
 * category's room once they're paid.
 */
export function budgetInsight(
  f: WaitingFacts,
): { runs: InsightRun[]; tone: "plain" | "warn" } | null {
  const runs: InsightRun[] = [];
  const unblocking = f.requests.find((r) => r.task && OPEN.has(r.task.status));
  if (unblocking?.task) {
    runs.push(
      { text: `Approving ${firstName(unblocking.submitter.name)}'s request unblocks ` },
      { text: unblocking.task.title, bold: true },
      { text: unblocking.event ? ` for ${unblocking.event.title}.` : "." },
    );
  }
  const byCategory = new Map<string, WaitingFacts["requests"]>();
  for (const r of f.requests) {
    if (r.category) byCategory.set(r.category.id, [...(byCategory.get(r.category.id) ?? []), r]);
  }
  const [, group] = [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length)[0] ?? [];
  let tone: "plain" | "warn" = "plain";
  if (group && group[0].category) {
    const cat = group[0].category;
    const left = cat.allocatedCents - cat.spentCents;
    const period = cat.periodLabel ? ` for ${cat.periodLabel}` : "";
    const lead = runs.length > 0 ? " " : "";
    const who =
      group.length === 1
        ? runs.length > 0 && unblocking === group[0]
          ? "It"
          : `Approving ${firstName(group[0].submitter.name)}'s request`
        : group.length === 2
          ? "Both together"
          : `All ${group.length} together`;
    if (left >= 0) {
      runs.push(
        { text: `${lead}${who} ${group.length === 1 ? "leaves" : "leave"} ` },
        { text: dollars(left), bold: true },
        { text: ` in ${cat.name}${period}.` },
      );
    } else {
      tone = "warn";
      runs.push(
        { text: `${lead}With ${group.length === 1 ? "it" : "them"}, ${cat.name} is ` },
        { text: `${dollars(-left)} over`, bold: true },
        { text: ` its budget${period}.` },
      );
    }
  }
  return runs.length > 0 ? { runs, tone } : null;
}
