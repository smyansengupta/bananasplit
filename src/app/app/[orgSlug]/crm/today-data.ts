import { cache } from "react";

import { todayRows, type TodayData } from "@/server/crm/today";
import { withOrgTx } from "@/server/db/context";

import type { CrmScope } from "@/lib/crm/scope";

import { crmTeam, type CrmShell } from "./shell";

/**
 * Today's rows for the viewer, once per request: Today and Power hour open
 * over it (?open=power) read the same list. `who` is Mine, My team (the
 * viewer and the people under them on the org chart) or Everyone's (a
 * Personal space is always everyone's: it's all yours). Keyed by the
 * shell, which crmShell dedupes per request.
 */
export const todayForShell = cache(async (shell: CrmShell, who: CrmScope): Promise<TodayData> => {
  const orgId = shell.org.id;
  const relationships = new Map(
    (shell.access.settings?.relationshipTypes ?? []).map((t) => [t.id, t.label]),
  );
  const team = who === "team" ? await crmTeam(orgId, shell.user.id) : [];
  return withOrgTx(orgId, ({ db }) =>
    todayRows(db, orgId, shell.user.id, shell.roles, {
      everyone: shell.access.personal || who === "all",
      team,
      relationships,
      personal: shell.access.personal,
    }),
  );
});

/** Today's ?who=: mine (the default), team or all. */
export function todayScope(who: unknown): CrmScope {
  return who === "all" || who === "team" ? who : "mine";
}
