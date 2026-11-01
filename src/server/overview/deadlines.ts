import type { Role } from "@/generated/prisma/enums";
import { can } from "@/lib/auth/permissions";
import {
  buildDeadlines,
  DEADLINE_DAYS,
  type DeadlineItem,
  type Deadlines,
} from "@/lib/overview/deadlines-text";
import { plural } from "@/lib/overview/text";
import { pollHref } from "@/lib/polls/paths";
import { addDaysToKey, dueDateKey, localDateKey } from "@/lib/tasks/dates";

import type { HomeShared } from "./home-data";

/**
 * Deadlines (Overview): hard dates in the next three weeks, as the member
 * sees them. Your open tasks' due dates; forms, quick polls, member polls
 * and Find a time polls closing; elections closing; and for finance roles
 * the budget period's last day. Events have no registration deadline (a
 * sign-up page closes by hand or when full), so none comes from there.
 *
 * No queries of its own: everything comes from the page's shared reads
 * (./home-data.ts), plus member polls' voters and the active budget period,
 * which the page reads once too.
 */

export interface DeadlinesInput {
  orgSlug: string;
  role: Role;
  timeZone: string;
  now: Date;
  shared: HomeShared;
  /** Voters on each open member poll (the page's poll stats). */
  voters: ReadonlyMap<string, number>;
  /** The active budget period, read for finance roles only. */
  budgetPeriod: { id: string; label: string; endsOn: Date } | null;
}

export function loadDeadlines(input: DeadlinesInput): Deadlines {
  const todayKey = localDateKey(input.now, input.timeZone);
  return buildDeadlines(deadlineItems(input), todayKey);
}

export function deadlineItems(input: DeadlinesInput): DeadlineItem[] {
  const { now, timeZone, shared } = input;
  const base = `/app/${input.orgSlug}`;
  const todayKey = localDateKey(now, timeZone);
  const lastKey = addDaysToKey(todayKey, DEADLINE_DAYS);
  const until = new Date(now.getTime() + DEADLINE_DAYS * 86_400_000);
  const inWindow = (at: Date | null): at is Date => at !== null && at > now && at <= until;
  const items: DeadlineItem[] = [];

  // Your open tasks due in the window (a due date is a calendar day).
  for (const t of shared.myDue) {
    if (!t.dueDate) continue;
    const dayKey = dueDateKey(t.dueDate);
    if (dayKey < todayKey || dayKey > lastKey) continue;
    const notStarted = t.status === "NOT_STARTED";
    items.push({
      key: `task:${t.id}`,
      kind: "task",
      dayKey,
      title: t.title,
      source:
        t.status === "BLOCKED"
          ? "Task, yours, blocked"
          : notStarted
            ? "Task, yours, not started"
            : "Task, yours",
      href: `${base}/tasks/${t.id}`,
      notStarted,
    });
  }

  // Forms and quick polls closing. Responses are owners' and admins' to
  // read (RLS): a member sees no count, and no "no answers yet".
  const admin = can({ role: input.role }, "settings.view");
  for (const form of shared.forms) {
    if (!inWindow(form.closesAt)) continue;
    const poll = form.kind === "QUICK_POLL";
    const outOf = form.members;
    items.push({
      key: `form:${form.id}`,
      kind: "form",
      dayKey: localDateKey(form.closesAt, timeZone),
      title: `${form.title} closes`,
      source: !admin
        ? poll
          ? "Quick poll"
          : "Form"
        : `${poll ? "Quick poll" : "Form"}, ${
            outOf
              ? `${form.responses} of ${outOf}`
              : plural(form.responses, poll ? "vote" : "response")
          }`,
      href: `${base}/forms/${form.id}`,
      notStarted: admin && form.responses === 0,
    });
  }

  // Member polls and Find a time polls closing.
  for (const q of shared.questions) {
    if (q.formId !== null || !inWindow(q.closesAt)) continue;
    const n = input.voters.get(q.id) ?? 0;
    items.push({
      key: `poll:${q.id}`,
      kind: "poll",
      dayKey: localDateKey(q.closesAt, timeZone),
      title: `${q.question} closes`,
      source: `Poll, ${n} voted`,
      href: pollHref(base, "question", q.id),
      notStarted: n === 0,
    });
  }
  for (const p of shared.availability) {
    if (!inWindow(p.closesAt)) continue;
    items.push({
      key: `availability:${p.id}`,
      kind: "poll",
      dayKey: localDateKey(p.closesAt, timeZone),
      title: `${p.title} closes`,
      source: "Find a time",
      href: pollHref(base, "availability", p.id),
      notStarted: false,
    });
  }

  // Elections closing (test ballots are already out).
  for (const e of shared.elections) {
    if (!inWindow(e.closesAt)) continue;
    items.push({
      key: `election:${e.id}`,
      kind: "election",
      dayKey: localDateKey(e.closesAt, timeZone),
      title: `${e.title} closes`,
      source: e.responses > 0 ? `Election, ${plural(e.responses, "vote")}` : "Election",
      href: e.databaseKey
        ? `${base}/databases/${e.databaseKey}?f=${encodeURIComponent(`poll:eq:${e.slug}`)}`
        : `${base}/forms`,
      notStarted: false,
    });
  }

  // The budget period's last day, for finance roles.
  const period = can({ role: input.role }, "finance.manage") ? input.budgetPeriod : null;
  if (period) {
    const dayKey = dueDateKey(period.endsOn);
    if (dayKey >= todayKey && dayKey <= lastKey) {
      items.push({
        key: `finance:${period.id}`,
        kind: "finance",
        dayKey,
        title: `${period.label} ends`,
        source: "Finance, budget period",
        href: `${base}/finance/budget?period=${period.id}`,
        notStarted: false,
      });
    }
  }
  return items;
}
