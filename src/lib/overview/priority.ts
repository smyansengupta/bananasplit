/**
 * How Ambient Home decides what leads (Home canvas, "How Ambient Home
 * decides what leads" and "twelve states"). Every widget gets a score from
 * what's going on right now, with one line saying why:
 *
 *   100  live now: a meeting in 15 minutes or under way, an event happening
 *    85  late or due today
 *    75  due tomorrow, not started
 *    65  waiting on you
 *    55  closes soon: a vote or form closing within a day
 *    45  a lot changed: five or more changes, or days away
 *    30  coming up: this week's meetings and events, the week ahead on a Monday
 *    10  usual
 *
 * A widget with nothing to show rests (the page knows that, not this).
 * Your role adds to scores: a treasurer's approvals count higher, an
 * owner's decisions too. ambientLayout (./ambient.ts) turns the scores into
 * the lead row. Pure, so each state is unit-tested.
 */

export interface WidgetScore {
  score: number;
  /** One line: why it's here ("Due tomorrow, not started"). */
  why: string;
}

export interface HomeSignals {
  /** The hour (0 to 23) and weekday (0 Sunday to 6 Saturday) where the member is. */
  hour: number;
  weekday: number;
  role: string;
  /** The next meeting: minutes until it starts (negative once started), and whether it's under way. */
  meeting: { title: string; startsInMin: number; underWay: boolean } | null;
  /** A meeting that ended in the last two hours. */
  meetingJustEnded: { title: string } | null;
  /** The next event, the same way, with its check-ins once it's under way. */
  event: { title: string; startsInMin: number; underWay: boolean; checkIns: number } | null;
  /** The member's own tasks. */
  overdue: number;
  dueToday: number;
  /** The first deadline due tomorrow that nobody has started. */
  tomorrowNotStarted: string | null;
  /** Deadlines due today. */
  deadlinesToday: number;
  /** Inbox rows that need the member, and how many are reimbursement requests. */
  waiting: { count: number; requests: number };
  /** An open vote closing within a day that the member hasn't answered. */
  voteClosing: string | null;
  /** Forms closing within a day. */
  formsClosing: number;
  /** Open decisions. */
  decisions: number;
  /** Changes since the member's last visit, and how many days ago that was. */
  changes: number;
  daysAway: number;
  /** Other members online now. */
  othersOnline: number;
  /** The next seven days. */
  week: { events: number; due: number; meetings: number };
}

export const USUAL = 10;
/** A widget leads only when something is going on: coming up or more. */
export const LEAD_MIN = 30;
/** Two at this or more share the lead row. */
export const SHARE_MIN = 75;

/** Late at night, only what scores this much stays; the rest rests until morning. */
export const NIGHT_MIN = 30;

export function isNight(hour: number): boolean {
  return hour >= 22 || hour < 5;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function soonWord(min: number): string {
  return min <= 1 ? "Starts in a minute" : `Starts in ${min} min`;
}

/** Every widget's score and why, by widget type. Types not listed are USUAL. */
export function scoreHome(s: HomeSignals): Map<string, WidgetScore> {
  const out = new Map<string, WidgetScore>();
  const set = (type: string, score: number, why: string) => {
    const had = out.get(type);
    if (!had || score > had.score) out.set(type, { score, why });
  };
  const finance = s.role === "TREASURER";
  const leads = s.role === "OWNER" || s.role === "ADMIN";

  // Live now.
  const m = s.meeting;
  if (m && (m.underWay || m.startsInMin <= 15)) {
    set("meetings", 100, m.underWay ? `${m.title} is on now` : soonWord(m.startsInMin));
  } else if (s.meetingJustEnded) {
    set("meetings", 70, `${s.meetingJustEnded.title} just ended: add the notes`);
  } else if (s.week.meetings > 0) {
    set("meetings", 30, `${plural(s.week.meetings, "meeting")} this week`);
  }
  const e = s.event;
  if (e?.underWay) {
    set(
      "events",
      100,
      e.checkIns > 0 ? `Happening now, ${e.checkIns} checked in` : "Happening now",
    );
  } else if (e && e.startsInMin <= 15) {
    set("events", 90, soonWord(e.startsInMin));
  } else if (s.week.events > 0) {
    set("events", 30, `${plural(s.week.events, "event")} this week`);
  }
  const live = (m && (m.underWay || m.startsInMin <= 15)) || e?.underWay;
  if (live && s.othersOnline >= 2) {
    set("here-now", 80, `${s.othersOnline} people in now`);
  }

  // Late or due today, then tomorrow.
  if (s.overdue > 0) set("my-tasks", 85, `${plural(s.overdue, "task")} late`);
  else if (s.dueToday > 0) set("my-tasks", 85, `${plural(s.dueToday, "task")} due today`);
  if (s.deadlinesToday > 0) set("deadlines", 85, `${plural(s.deadlinesToday, "deadline")} today`);
  else if (s.tomorrowNotStarted) set("deadlines", 75, "Due tomorrow, not started");

  // Waiting on you; a treasurer's approvals count higher.
  if (s.waiting.count > 0) {
    const requests = finance && s.waiting.requests > 0;
    set(
      "waiting-on-you",
      requests ? 80 : 65,
      requests
        ? `${plural(s.waiting.requests, "reimbursement")} to approve`
        : `${s.waiting.count} waiting on you`,
    );
  }
  if (s.decisions > 0) {
    set("decisions", leads ? 65 : 45, `${plural(s.decisions, "decision")} open`);
  }

  // Closes soon.
  if (s.voteClosing) set("votes", 55, "Closes soon, you haven't voted");
  if (s.formsClosing > 0) set("polls", 55, `${plural(s.formsClosing, "form")} closing soon`);

  // A lot changed.
  if (s.daysAway >= 3 && s.changes > 0) {
    set("since-you-were-here", 45, `${plural(s.changes, "change")} in ${s.daysAway} days`);
  } else if (s.changes >= 5) {
    set("since-you-were-here", 45, `${s.changes} changes since you were here`);
  }

  // The week's rhythm: Monday opens on the week ahead, Friday to Sunday on the wrap.
  if (s.weekday === 1 && s.hour < 15 && (s.week.events > 0 || s.week.due > 0)) {
    set("week", 35, `The week ahead: ${plural(s.week.events, "event")}, ${s.week.due} due`);
  }
  if ((s.weekday === 5 && s.hour >= 12) || s.weekday === 6 || s.weekday === 0) {
    set("weekly-pulse", 40, "The week's wrap");
  }
  return out;
}

export function scoreOf(
  scores: ReadonlyMap<string, WidgetScore> | undefined,
  type: string,
): number {
  return scores?.get(type)?.score ?? USUAL;
}
