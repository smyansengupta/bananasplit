/**
 * Home's ambient buttons (Home canvas, "Ambient buttons: Home"): which one
 * a card or widget gets right now, and why. The server picks them from
 * what Home already read; src/components/overview/home-act.tsx draws them.
 * Each is a link to where the job is done, plain data so it can cross from
 * the server. At most two on any one thing.
 */

export type HomeActKind =
  "join" | "check-in" | "draft-agenda" | "add-notes" | "thank-you" | "post-recap" | "join-them";

export interface HomeAct {
  kind: HomeActKind;
  href: string;
  /** Why it's here, in a few words ("Starts in 10 min"). */
  reason: string;
  /** Opens in a new tab (a call). */
  external?: boolean;
}

/** Join only opens a secure web link, never whatever else was typed in. */
export function joinable(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

/** Friday afternoon to Sunday: when the week's recap is the thing to do. */
export function recapTime(weekday: number, hour: number): boolean {
  return (weekday === 5 && hour >= 12) || weekday === 6 || weekday === 0;
}
