/**
 * Whose records a CRM list shows, as Tasks' scope chips (Mine, My team,
 * Everyone): People writes it as ?owner= (me, team, or nothing for
 * everyone), Today as ?who= (mine, team, all). "My team" is the viewer and
 * the people under them on the org chart, so it shows only to someone with
 * reports, as in Tasks.
 */
export type CrmScope = "mine" | "team" | "all";

/** People's ?owner= as the server reads it: "team" becomes the viewer and their reports. */
export function ownerParamFor(owner: string | undefined, team: readonly string[]): string | undefined {
  if (owner !== "team") return owner;
  return ["me", ...team].join(",");
}
