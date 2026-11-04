import { cache } from "react";

import { todayRows, type TodayData } from "@/server/crm/today";
import { withOrgTx } from "@/server/db/context";

import type { CrmShell } from "./shell";

/**
 * Today's rows for the viewer, once per request: Today and Power hour open
 * over it (?open=power) read the same list. `everyone` is Mine or
 * Everyone's (a Personal space is always everyone's: it's all yours).
 * Keyed by the shell, which crmShell dedupes per request.
 */
export const todayForShell = cache((shell: CrmShell, everyone: boolean): Promise<TodayData> => {
  const orgId = shell.org.id;
  const relationships = new Map(
    (shell.access.settings?.relationshipTypes ?? []).map((t) => [t.id, t.label]),
  );
  return withOrgTx(orgId, ({ db }) =>
    todayRows(db, orgId, shell.user.id, shell.roles, {
      everyone: shell.access.personal || everyone,
      relationships,
      personal: shell.access.personal,
    }),
  );
});
