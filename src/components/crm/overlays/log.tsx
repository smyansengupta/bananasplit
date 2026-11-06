import { LogCard } from "@/components/crm/cards/log-card";
import { effectiveTimezone } from "@/lib/tasks/dates";
import { dayLabel, onItsOwn, onItsOwnWeek } from "@/server/crm/on-its-own";
import { withOrgTx } from "@/server/db/context";

import type { OverlayProps } from "./crm-overlays";

/** Done on its own (?open=log): what the CRM did without asking, this week. */
export async function LogOverlay({ shell, orgSlug }: OverlayProps<"log">) {
  const orgId = shell.org.id;
  const now = new Date();
  const { entries, tz } = await withOrgTx(orgId, async ({ db }) => {
    const me = await db.user.findUnique({
      where: { id: shell.user.id },
      select: { timezone: true },
    });
    const tz = effectiveTimezone(me, shell.org);
    return { entries: await onItsOwn(db, orgId, { now, tz }), tz };
  });
  return (
    <LogCard
      orgId={orgId}
      settingsHref={`/app/${orgSlug}/crm/settings/automations`}
      week={onItsOwnWeek(entries, now, tz)}
      entries={entries.map((e) => ({
        id: e.id,
        kind: e.kind,
        day: dayLabel(e.at, now, tz),
        time: e.at.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          timeZone: tz,
        }),
        text: e.text,
        why: e.why,
        undo: e.undo,
        send: e.send,
      }))}
    />
  );
}
