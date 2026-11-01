import { addDaysToKey, mondayOfKey } from "@/lib/tasks/dates";

import { listWords } from "./text";

/**
 * The one-sentence findings on Home's kept widgets (My tasks, This week,
 * Events, the Weekly pulse), worked out from what the page already read.
 * Pure, so the rules are unit-tested (insights.test.ts). Each returns null
 * when the data doesn't support a finding: a widget then shows none.
 */

/** A task of the viewer's with a due day (yyyy-mm-dd). */
export interface DueTask {
  id: string;
  title: string;
  dueKey: string;
}

/** An event on a day, and how big it is (RSVPs, or seats when there are none). */
export interface SizedEvent {
  id: string;
  title: string;
  dayKey: string;
  size: number;
}

/** "3 of your tasks land in Fall Social week" needs at least this many. */
export const CROWDED_WEEK_TASKS = 3;

/**
 * The first Monday-to-Sunday week, from this one on, where the viewer has
 * CROWDED_WEEK_TASKS or more tasks due and the organization holds an event:
 * that week's biggest event and the tasks due in it, latest first. Null when
 * no week is that crowded.
 */
export function crowdedEventWeek(
  tasks: readonly DueTask[],
  events: readonly SizedEvent[],
): { event: SizedEvent; tasks: DueTask[]; weekStart: string } | null {
  const weeks = [...new Set(events.map((e) => mondayOfKey(e.dayKey)))].sort();
  for (const weekStart of weeks) {
    const weekEnd = addDaysToKey(weekStart, 6);
    const due = tasks
      .filter((t) => t.dueKey >= weekStart && t.dueKey <= weekEnd)
      .sort((a, b) => b.dueKey.localeCompare(a.dueKey));
    if (due.length < CROWDED_WEEK_TASKS) continue;
    const biggest = events
      .filter((e) => mondayOfKey(e.dayKey) === weekStart)
      .sort((a, b) => b.size - a.size || a.dayKey.localeCompare(b.dayKey))[0];
    if (biggest) return { event: biggest, tasks: due, weekStart };
  }
  return null;
}

/** A timed or all-day event on one day of This week, in minutes after midnight. */
export interface DayEvent {
  id: string;
  title: string;
  allDay: boolean;
  start: number;
  end: number;
}

export interface DayLoad {
  key: string;
  /** Two timed events overlap. */
  clash: [DayEvent, DayEvent] | null;
  /** Three or more things (events and the viewer's deadlines) on the day. */
  crowded: boolean;
  /** Nothing timed from 5 PM on, and no all-day event. */
  freeEvening: boolean;
}

const EVENING = 17 * 60;
/** A day with this many events and deadlines is crowded. */
export const CROWDED_DAY = 3;

export function dayLoad(key: string, events: readonly DayEvent[], deadlines: number): DayLoad {
  const timed = [...events.filter((e) => !e.allDay)].sort((a, b) => a.start - b.start);
  let clash: [DayEvent, DayEvent] | null = null;
  for (let i = 1; i < timed.length && !clash; i++) {
    for (let j = 0; j < i; j++) {
      if (timed[j]!.end > timed[i]!.start) {
        clash = [timed[j]!, timed[i]!];
        break;
      }
    }
  }
  return {
    key,
    clash,
    crowded: events.length + deadlines >= CROWDED_DAY,
    freeEvening: !events.some((e) => e.allDay || e.end > EVENING),
  };
}

/**
 * How many of an upcoming event's RSVPs should come, from the check-in rate
 * of past events of its kind. Null without a rate or RSVPs.
 */
export function expectedHeadcount(rsvps: number, rate: number | null | undefined): number | null {
  if (!rate || rsvps <= 0) return null;
  return Math.round(rsvps * rate);
}

/** A whole percentage: 0.814 is "81%". */
export function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** The lines of a meeting's agenda (its description) that are items: not blank, bullets and numbers stripped. */
export function agendaItems(description: string | null): string[] {
  if (!description) return [];
  return description
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
}

/** One finding: an optional bold lead, then the rest of the sentence. */
export interface Finding {
  tone: "plain" | "warn" | "good";
  lead?: string;
  text: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** My tasks' warning: CROWDED_WEEK_TASKS or more of your deadlines in a big event's week. */
export function myTasksFinding(crowded: ReturnType<typeof crowdedEventWeek>): Finding | null {
  if (!crowded) return null;
  const titles = crowded.tasks.slice(0, 3).map((t) => t.title);
  const rest = crowded.tasks.length - titles.length;
  return {
    tone: "warn",
    lead: `${crowded.tasks.length} of your tasks land in ${crowded.event.title} week:`,
    text: `${listWords(rest > 0 ? [...titles, plural(rest, "more")] : titles)}.`,
  };
}

/** This week's finding: the first day with a clash, else the first crowded one. */
export function weekFinding(
  days: readonly {
    weekday: string;
    load: DayLoad;
    events: readonly { title: string }[];
    deadlines: readonly { title: string }[];
  }[],
): Finding | null {
  const clash = days.find((d) => d.load.clash);
  if (clash?.load.clash) {
    const [a, b] = clash.load.clash;
    return {
      tone: "warn",
      lead: `${clash.weekday} has a clash:`,
      text: `${a.title} and ${b.title} overlap.`,
    };
  }
  const crowded = days.find((d) => d.load.crowded);
  if (crowded) {
    const things = [
      ...crowded.events.map((e) => e.title),
      ...crowded.deadlines.map((t) => `the ${t.title} deadline`),
    ];
    return {
      tone: "warn",
      lead: `${crowded.weekday} is crowded:`,
      text: `${listWords(things)} all land on the same day.`,
    };
  }
  return null;
}

/**
 * The Weekly pulse's finding, from the finished weeks (oldest first): a
 * record week, or a run of weeks under the average, and the epic that moved
 * most in the latest issue.
 */
export function pulseFinding(
  finished: readonly { done: number }[],
  topEpic: { name: string; done: number } | null,
): Finding | null {
  if (finished.length < 3) return null;
  const last = finished.at(-1)!.done;
  const earlier = finished.slice(0, -1);
  const average = finished.reduce((n, w) => n + w.done, 0) / finished.length;
  const epic = topEpic && topEpic.done > 0 ? ` ${topEpic.name} took ${topEpic.done} of them.` : "";
  if (last > 0 && earlier.every((w) => w.done < last)) {
    return {
      tone: "good",
      lead: `${plural(last, "task")} done last week,`,
      text: `the most in ${finished.length} weeks.${epic}`,
    };
  }
  let run = 0;
  for (let i = finished.length - 1; i >= 0 && finished[i]!.done < average; i--) run++;
  if (run >= 2) {
    return {
      tone: "warn",
      lead: `Under the average for ${run} weeks in a row:`,
      text: `${last} done last week against ${Math.round(average * 10) / 10} a week.${epic}`,
    };
  }
  return topEpic && topEpic.done > 0
    ? {
        tone: "plain",
        lead: `${topEpic.name} moved most last week,`,
        text: `with ${plural(topEpic.done, "task")} done.`,
      }
    : null;
}
