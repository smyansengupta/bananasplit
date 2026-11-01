import type { ItemRef } from "@/components/overview/connections";

import { countWord, dollars, listWords, plural, signed } from "./text";

/**
 * The week, recapped: what the loader counted (RecapFacts) turned into
 * sentences, stat tiles and up to three findings. Sentence templates only,
 * no AI, and nothing is made up: a part with no data is left out rather
 * than written as a zero. Pure, so every template is unit tested.
 */

export interface RecapFacts {
  base: string;
  /** "Oct 25" and "Oct 31": the seven days recapped. */
  from: string;
  to: string;
  tasks: {
    done: number;
    before: number;
    /** The epic most of the finished tasks were in, when one stands out. */
    topEpic: { id: string; title: string; count: number } | null;
    /** Tasks finished in each of the last weeks, this week first. */
    weekly: number[];
    /** The first day of each of those weeks ("Sep 14"), this week first. */
    weekStarts: string[];
  };
  members: {
    joined: number;
    before: number;
    people: { id: string; name: string | null }[];
  };
  /** The last event of the week that anyone checked in to. */
  lastEvent: {
    id: string;
    title: string;
    checkedIn: number;
    /** Who said they'd come, when the viewer can see that number. */
    rsvps: number | null;
  } | null;
  /** Null when the viewer can't see finance. */
  money: {
    spentCents: number;
    beforeCents: number;
    /** The active budget period: spent of allocated so far. */
    period: { id: string; label: string; spentCents: number; allocatedCents: number } | null;
    transactions: number;
  } | null;
  notes: {
    written: number;
    before: number;
    comments: number;
    /** The note with the most comments this week. */
    busiest: { id: string; title: string; comments: number } | null;
  };
  /** Events and meetings held in the week (for the foot line). */
  held: { meetings: number; events: number };
  /** An upcoming event filling faster than the last one of its kind did (admins only). */
  filling: {
    event: { id: string; title: string };
    rsvps: number;
    daysOut: number;
    prior: { id: string; title: string; atThisPoint: number; final: number };
  } | null;
  /** An event in the next 7 days with blocked tasks linked to it. */
  atRisk: {
    event: { id: string; title: string; daysOut: number };
    blocked: { id: string; title: string }[];
    /** Other open tasks linked to it (not blocked). */
    open: number;
  } | null;
  /** Reimbursements waiting over 10 days (finance only). */
  waiting: {
    count: number;
    people: { id: string; name: string | null }[];
    /** A blocked task one of them is for. */
    blockedTask: { id: string; title: string } | null;
  } | null;
  /** The task blocked the longest, at least a week. */
  longBlocked: { id: string; title: string; days: number } | null;
}

export type RecapTone = "good" | "risk" | "stuck";

export interface RecapFinding {
  tone: RecapTone;
  text: string;
  chips: ItemRef[];
}

export interface RecapStat {
  key: "tasks" | "members" | "attendance" | "spent" | "notes";
  label: string;
  value: string;
  /** Beside the number: the change ("+9"), "of 58", "31 comments". */
  aside: string | null;
  asideTone: "up" | "down" | "plain";
  sub: string | null;
  href: string;
}

/** A run of the summary; `bold` runs are the numbers that matter. */
export interface RecapRun {
  text: string;
  bold?: boolean;
}

export interface RecapWeek {
  range: string;
  summary: RecapRun[];
  stats: RecapStat[];
  findings: RecapFinding[];
  /** "Written from 23 tasks, 4 meetings ..." or null when nothing was counted. */
  foot: string | null;
  /**
   * The whole recap as plain text (Copy; posting writes it again for the
   * "organization" audience, so it's the announcement's body too).
   */
  text: string;
  /** The announcement's title. */
  title: string;
}

const RUN_SPACE: RecapRun = { text: " " };

/** How every recap announcement's title starts ("The week, recapped: Oct 25 to Oct 31"). */
export const RECAP_TITLE = "The week, recapped";

/**
 * "The busiest week since Sep 14" when this week beat the weeks before it:
 * since the last week that did as well, or "in N weeks" when none did.
 * Null for a quiet week or too little history to say.
 */
export function busiestLine(
  weekly: readonly number[],
  weekStarts: readonly string[],
): string | null {
  const now = weekly[0] ?? 0;
  if (now < 5 || weekly.length < 4) return null;
  const earlier = weekly.slice(1);
  const matched = earlier.findIndex((n) => n >= now);
  if (matched === -1) return `The busiest week in ${weekly.length} weeks.`;
  // Beating only last week isn't news.
  if (matched < 2) return null;
  return `The busiest week since the week of ${weekStarts[matched + 1]}.`;
}

/** Whether `top` is a real share of `total` (at least 3 and two in five). */
function standsOut(top: number, total: number): boolean {
  return top >= 3 && top * 5 >= total * 2;
}

function tasksAndMembers(f: RecapFacts): RecapRun[] {
  const runs: RecapRun[] = [];
  const { done, topEpic } = f.tasks;
  const joined = f.members.joined;
  if (done > 0) {
    runs.push({ text: "The team finished " }, { text: plural(done, "task"), bold: true });
    if (topEpic && standsOut(topEpic.count, done)) {
      runs.push({
        text:
          topEpic.count === done
            ? `, all in ${topEpic.title}`
            : `, ${topEpic.count} of them in ${topEpic.title}`,
      });
    }
    if (joined > 0) {
      runs.push(
        { text: ", and " },
        { text: `${plural(joined, "person", "people")} joined`, bold: true },
      );
    }
    runs.push({ text: "." });
  } else if (joined > 0) {
    runs.push({ text: `${plural(joined, "person", "people")} joined`, bold: true }, { text: "." });
  }
  return runs;
}

function eventRuns(f: RecapFacts): RecapRun[] {
  const e = f.lastEvent;
  if (!e || e.checkedIn === 0) return [];
  const came = { text: plural(e.checkedIn, "person", "people"), bold: true };
  if (e.rsvps && e.rsvps > 0) {
    // More came than said so (walk-ins): a share past 100% reads wrong.
    if (e.checkedIn > e.rsvps) {
      return [came, { text: ` checked in at ${e.title}, more than the ${e.rsvps} who RSVPed.` }];
    }
    const pct = Math.round((e.checkedIn / e.rsvps) * 100);
    return [came, { text: ` checked in at ${e.title}, ${pct}% of the ${e.rsvps} who RSVPed.` }];
  }
  return [came, { text: ` checked in at ${e.title}.` }];
}

function moneyAndNotes(f: RecapFacts): RecapRun[] {
  const parts: RecapRun[][] = [];
  if (f.money && f.money.spentCents > 0) {
    parts.push([{ text: dollars(f.money.spentCents), bold: true }, { text: " went out" }]);
  }
  const { written, comments } = f.notes;
  if (written > 0) {
    parts.push([
      { text: plural(written, "note"), bold: true },
      { text: written === 1 ? " was written" : " were written" },
    ]);
  }
  if (comments > 0) parts.push([{ text: `${plural(comments, "comment")} left` }]);
  if (parts.length === 0) return [];
  const runs: RecapRun[] = [];
  parts.forEach((p, i) => {
    if (i > 0) runs.push({ text: i === parts.length - 1 ? " and " : ", " });
    runs.push(...p);
  });
  // A sentence starts with a capital, even when it starts with "comments".
  const first = runs[0];
  runs[0] = { ...first, text: first.text.charAt(0).toUpperCase() + first.text.slice(1) };
  runs.push({ text: "." });
  return runs;
}

function daysOutWord(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

/** The three findings: going well, at risk, stuck; each only when there's one. */
export function recapFindings(f: RecapFacts): RecapFinding[] {
  const out: RecapFinding[] = [];
  const event = (e: { id: string; title: string }): ItemRef => ({
    kind: "event",
    label: e.title,
    href: `${f.base}/meetings/${e.id}`,
  });
  const task = (t: { id: string; title: string }): ItemRef => ({
    kind: "task",
    label: t.title,
    href: `${f.base}/tasks/${t.id}`,
  });
  const person = (p: { id: string; name: string | null }): ItemRef => ({
    kind: "person",
    label: p.name ?? "Member",
    href: `${f.base}/people/${p.id}`,
  });

  // Going well: an event filling faster than the last of its kind, else a
  // real rise in work done, else in new members.
  const fill = f.filling;
  if (fill && fill.rsvps > fill.prior.atThisPoint) {
    out.push({
      tone: "good",
      text: `${fill.event.title} has ${plural(fill.rsvps, "RSVP")} ${countWord(fill.daysOut, "day")} out. ${fill.prior.title} had ${fill.prior.atThisPoint} at this point and ended at ${fill.prior.final}.`,
      chips: [event(fill.event), event(fill.prior)],
    });
  } else if (f.tasks.done >= f.tasks.before + 3 && f.tasks.before > 0) {
    const top = f.tasks.topEpic;
    out.push({
      tone: "good",
      text: `The team finished ${plural(f.tasks.done, "task")}, up from ${f.tasks.before} the week before.`,
      chips: [
        ...(top && standsOut(top.count, f.tasks.done) ? [task(top)] : []),
        {
          kind: "task",
          label: "Finished tasks",
          href: `${f.base}/tasks?view=list&status=COMPLETED`,
        },
      ],
    });
  } else if (f.members.joined >= 3 && f.members.joined > f.members.before) {
    out.push({
      tone: "good",
      text: `${plural(f.members.joined, "person", "people")} joined, against ${f.members.before} the week before.`,
      chips: f.members.people.slice(0, 3).map(person),
    });
  }

  const risk = f.atRisk;
  if (risk && risk.blocked.length > 0) {
    const names = risk.blocked.slice(0, 2).map((t) => t.title);
    const blocked =
      risk.blocked.length <= 2
        ? `${listWords(names)} ${risk.blocked.length === 1 ? "is" : "are"} blocked`
        : `${listWords(names)} and ${risk.blocked.length - 2} more are blocked`;
    const open =
      risk.open > 0
        ? `, and ${plural(risk.open, "other task")} ${risk.open === 1 ? "is" : "are"} still open`
        : "";
    out.push({
      tone: "risk",
      text: `${risk.event.title} is ${daysOutWord(risk.event.daysOut)}. ${blocked}${open}.`,
      chips: [event(risk.event), ...risk.blocked.slice(0, 2).map(task)],
    });
  }

  const wait = f.waiting;
  if (wait && wait.count > 0) {
    const tail = wait.blockedTask
      ? `, and ${wait.blockedTask.title} is blocked on one of them`
      : "";
    out.push({
      tone: "stuck",
      text: `${countWord(wait.count, "reimbursement", "reimbursements", true)} ${wait.count === 1 ? "has" : "have"} waited over 10 days${tail}.`,
      chips: [
        {
          kind: "money",
          label: plural(wait.count, "reimbursement"),
          href: `${f.base}/finance/transactions?view=review`,
        },
        ...(wait.blockedTask ? [task(wait.blockedTask)] : []),
        ...wait.people.slice(0, 2).map(person),
      ],
    });
  } else if (f.longBlocked) {
    out.push({
      tone: "stuck",
      text: `${f.longBlocked.title} has been blocked for ${plural(f.longBlocked.days, "day")}.`,
      chips: [task(f.longBlocked)],
    });
  }
  return out;
}

function delta(now: number, before: number): Pick<RecapStat, "aside" | "asideTone"> {
  const d = now - before;
  return { aside: signed(d) || null, asideTone: d > 0 ? "up" : d < 0 ? "down" : "plain" };
}

/** The five tiles, each only when its number isn't zero. */
export function recapStats(f: RecapFacts): RecapStat[] {
  const out: RecapStat[] = [];
  if (f.tasks.done > 0) {
    out.push({
      key: "tasks",
      label: "Tasks done",
      value: String(f.tasks.done),
      ...delta(f.tasks.done, f.tasks.before),
      sub: `${f.tasks.before} the week before`,
      href: `${f.base}/tasks?view=list&status=COMPLETED`,
    });
  }
  if (f.members.joined > 0) {
    const names = f.members.people
      .map((p) => p.name?.trim().split(/\s+/)[0])
      .filter(Boolean) as string[];
    const shown = names.slice(0, 2);
    const rest = f.members.joined - shown.length;
    out.push({
      key: "members",
      label: "New members",
      value: String(f.members.joined),
      ...delta(f.members.joined, f.members.before),
      sub:
        shown.length > 0
          ? rest > 0
            ? `${shown.join(", ")} and ${rest} more`
            : listWords(shown)
          : null,
      href: `${f.base}/people`,
    });
  }
  const e = f.lastEvent;
  if (e && e.checkedIn > 0) {
    out.push({
      key: "attendance",
      label: `Came to ${e.title}`,
      value: String(e.checkedIn),
      aside: e.rsvps && e.checkedIn <= e.rsvps ? `of ${e.rsvps}` : null,
      asideTone: e.rsvps && e.checkedIn < e.rsvps ? "down" : "plain",
      sub: e.rsvps
        ? e.checkedIn > e.rsvps
          ? "More than RSVPed"
          : `${Math.round((e.checkedIn / e.rsvps) * 100)}% of RSVPs checked in`
        : "Checked in",
      href: `${f.base}/meetings/${e.id}`,
    });
  }
  const m = f.money;
  if (m && m.spentCents > 0) {
    out.push({
      key: "spent",
      label: "Spent",
      value: dollars(m.spentCents),
      aside: null,
      asideTone: "plain",
      sub:
        m.period && m.period.allocatedCents > 0
          ? `${dollars(m.period.spentCents)} of ${dollars(m.period.allocatedCents)} this term`
          : `${dollars(m.beforeCents)} the week before`,
      href: `${f.base}/finance`,
    });
  }
  const n = f.notes;
  if (n.written > 0) {
    out.push({
      key: "notes",
      label: "Notes written",
      value: String(n.written),
      aside: n.comments > 0 ? plural(n.comments, "comment") : null,
      asideTone: "plain",
      sub: n.busiest ? `${n.busiest.title} had the most` : `${n.before} the week before`,
      href: n.busiest ? `${f.base}/notes/${n.busiest.id}` : `${f.base}/notes`,
    });
  }
  return out;
}

/** "Written from 23 tasks, 4 meetings, 9 notes, 12 transactions and 2 events." */
export function recapFoot(f: RecapFacts): string | null {
  const parts = [
    f.tasks.done > 0 ? plural(f.tasks.done, "task") : null,
    f.held.meetings > 0 ? plural(f.held.meetings, "meeting") : null,
    f.notes.written > 0 ? plural(f.notes.written, "note") : null,
    f.notes.comments > 0 ? plural(f.notes.comments, "comment") : null,
    f.members.joined > 0 ? plural(f.members.joined, "new member") : null,
    f.money && f.money.transactions > 0 ? plural(f.money.transactions, "transaction") : null,
    f.held.events > 0 ? plural(f.held.events, "event") : null,
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? `Written from ${listWords(parts)}.` : null;
}

/** The recap's written summary, as runs (bold numbers). */
export function recapSummary(f: RecapFacts): RecapRun[] {
  const sentences: RecapRun[][] = [];
  const busiest = busiestLine(f.tasks.weekly, f.tasks.weekStarts);
  if (busiest) sentences.push([{ text: busiest }]);
  for (const s of [tasksAndMembers(f), eventRuns(f), moneyAndNotes(f)]) {
    if (s.length > 0) sentences.push(s);
  }
  const risk = f.atRisk;
  if (risk && risk.blocked.length > 0) {
    sentences.push([
      {
        text: `${risk.event.title} is ${daysOutWord(risk.event.daysOut)} with ${plural(risk.blocked.length, "blocked task")}.`,
      },
    ]);
  }
  const out: RecapRun[] = [];
  sentences.forEach((s, i) => {
    if (i > 0) out.push(RUN_SPACE);
    out.push(...s);
  });
  return out;
}

export function runsText(runs: readonly RecapRun[]): string {
  return runs.map((r) => r.text).join("");
}

/** Everything the widget shows, from the counts. */
export function buildRecapWeek(f: RecapFacts): RecapWeek {
  const range = `${f.from} to ${f.to}`;
  const summary = recapSummary(f);
  const stats = recapStats(f);
  const findings = recapFindings(f);
  const LABEL: Record<RecapTone, string> = { good: "Going well", risk: "At risk", stuck: "Stuck" };
  const lines = [
    runsText(summary),
    stats.length > 0
      ? stats
          .map(
            (s) =>
              `${s.label}: ${s.value}${s.aside ? ` (${s.aside})` : ""}${s.sub ? `, ${s.sub}` : ""}`,
          )
          .join("\n")
      : "",
    findings.map((x) => `${LABEL[x.tone]}: ${x.text}`).join("\n"),
  ].filter((l) => l.trim() !== "");
  return {
    range,
    summary,
    stats,
    findings,
    foot: recapFoot(f),
    text: lines.join("\n\n"),
    title: `${RECAP_TITLE}: ${range}`,
  };
}

export const RECAP_TONE_LABEL: Record<RecapTone, string> = {
  good: "Going well",
  risk: "At risk",
  stuck: "Stuck",
};
