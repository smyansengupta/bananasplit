import type { ReportTier } from "./types";

/**
 * The viewer tier for reports, from the caller's membership role (computed
 * after authorization, then passed explicitly to every loader and SQL
 * function). OWNER and ADMIN keep their tier; TREASURER and MEMBER are
 * MEMBER, the same mapping as app.can_view_rows and app.ballot_tally.
 * Anything else (no membership) is null: no reports at all.
 */
export function reportTier(role: string | null | undefined): ReportTier | null {
  switch (role) {
    case "OWNER":
      return "OWNER";
    case "ADMIN":
      return "ADMIN";
    case "TREASURER":
    case "MEMBER":
      return "MEMBER";
    default:
      return null;
  }
}
