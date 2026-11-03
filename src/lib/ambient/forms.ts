/**
 * When the ambient buttons on Forms, Pulse and the Plan page show (Buttons
 * canvas, Forms, Pulse, org chart and settings): Share again on a form about
 * to close with few answers, Make a report on a closed one, Send now on a
 * pulse draft, and Free up space when storage is nearly full. Pure, so the
 * pages decide and the tests pin it.
 */

const HOUR = 3_600_000;

/** "Closes in two days": within this many hours. */
export const CLOSING_HOURS = 48;
/** With nothing to compare against, fewer than this many answers is few. */
export const FEW_ANSWERS = 10;
/** Storage is nearly full from this share used. */
export const STORAGE_FULL_SHARE = 0.9;

export interface FormFacts {
  open: boolean;
  draft: boolean;
  closesAt: Date | string | null;
  responses: number;
  /** Members only: how many members could answer. */
  outOf?: number | null;
  /** The answers the organization's last form got, when there was one. */
  lastTime?: number | null;
}

/** Hours until it closes, while it's open and closing within two days. */
export function closingWithin(
  f: Pick<FormFacts, "open" | "draft" | "closesAt">,
  now: Date,
): number | null {
  if (!f.open || f.draft || !f.closesAt) return null;
  const hours = (new Date(f.closesAt).getTime() - now.getTime()) / HOUR;
  return hours > 0 && hours <= CLOSING_HOURS ? hours : null;
}

/** Few answers: under half the members, fewer than last time, or under ten. */
export function fewAnswers(f: Pick<FormFacts, "responses" | "outOf" | "lastTime">): boolean {
  if (f.outOf) return f.responses < f.outOf / 2;
  if (f.lastTime != null && f.lastTime > 0) return f.responses < f.lastTime;
  return f.responses < FEW_ANSWERS;
}

/**
 * Share again: closing in two days with few answers. The reason ("12
 * answers, closes in 2 days", and "fewer than last time" when it is).
 */
export function shareAgain(f: FormFacts, now: Date): { reason: string } | null {
  const hours = closingWithin(f, now);
  if (hours === null || !fewAnswers(f)) return null;
  const answers = f.responses === 1 ? "1 answer" : `${f.responses} answers`;
  const when = hours <= 24 ? "closes in a day" : `closes in ${Math.ceil(hours / 24)} days`;
  const behind = !f.outOf && f.lastTime != null && f.responses < f.lastTime;
  return { reason: behind ? `${answers}, fewer than last time` : `${answers}, ${when}` };
}

/** What Share again posts to everyone. */
export function shareAgainPost(
  title: string,
  closesAt: Date | string,
  link: string,
  timeZone: string,
) {
  const day = new Date(closesAt).toLocaleDateString("en-US", { weekday: "long", timeZone });
  return {
    title: `${title} closes ${day}`.slice(0, 120),
    body: `There's still time to answer. It takes a few minutes: ${link}`,
  };
}

/** Make a report: closed (not a draft) with answers, and no report reads it yet. */
export function makeReport(
  f: Pick<FormFacts, "open" | "draft" | "responses"> & { hasReport: boolean },
): { reason: string } | null {
  if (f.open || f.draft || f.responses === 0 || f.hasReport) return null;
  return {
    reason: f.responses === 1 ? "Closed with 1 answer" : `Closed with ${f.responses} answers`,
  };
}

/** Send now: this week's pulse is written and hasn't gone out. */
export function pulseReady(issue: { sentAt: Date | string | null }, enabled: boolean): boolean {
  return enabled && issue.sentAt === null;
}

/** Free up space: 90% of the plan's storage used. The share used, or null. */
export function storageNearlyFull(usedBytes: number, limitBytes: number): number | null {
  if (limitBytes <= 0) return null;
  const share = usedBytes / limitBytes;
  return share >= STORAGE_FULL_SHARE ? share : null;
}
