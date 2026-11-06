import Link from "next/link";
import { cache } from "react";

import { SettingsCard } from "@/app/app/[orgSlug]/settings/settings-card";
import { crmRecordHref } from "@/lib/crm/href";
import { formatDuration, outcomeLabel } from "@/lib/crm/phone";
import { when } from "@/lib/crm/when";
import { withOrgTx } from "@/server/db/context";

/** Once per request: You starts it beside its own reads. */
const loadCalls = cache((orgId: string, userId: string) =>
  withOrgTx(orgId, ({ db }) =>
    db.crmCall.findMany({
      where: { organizationId: orgId, userId },
      orderBy: { startedAt: "desc" },
      take: 10,
      select: {
        id: true,
        startedAt: true,
        outcome: true,
        durationSec: true,
        recordingKey: true,
        person: { select: { id: true, name: true } },
      },
    }),
  ),
);

export function preloadRecentCalls(orgId: string, userId: string) {
  void loadCalls(orgId, userId).catch(() => null);
}

/**
 * Your recent calls (CRM settings > You; it was on the Calls page): the
 * last ten you made or took, each with who, how it went, how long, when,
 * and its recording when there is one. Nothing shows until you've had a
 * call. A person's own calls are on their card's Timeline.
 */
export async function RecentCalls({ orgId, orgSlug, userId }: { orgId: string; orgSlug: string; userId: string }) {
  const calls = await loadCalls(orgId, userId);
  if (calls.length === 0) return null;
  return (
    <SettingsCard title="Your recent calls">
      <ul className="divide-border divide-y text-sm">
        {calls.map((c) => (
          <li key={c.id} className="space-y-1.5 py-2">
            <div className="flex items-baseline gap-2">
              {c.person ? (
                <Link
                  href={crmRecordHref(orgSlug, "person", c.person.id)}
                  className="truncate font-semibold hover:underline"
                >
                  {c.person.name}
                </Link>
              ) : (
                <b>A call</b>
              )}
              <span className="text-muted-foreground">{outcomeLabel(c.outcome)}</span>
              <span className="text-muted-foreground ms-auto shrink-0 text-xs tabular-nums">
                {c.durationSec ? `${formatDuration(c.durationSec)}, ` : ""}
                {when(c.startedAt)}
              </span>
            </div>
            {c.recordingKey && (
              <audio
                controls
                preload="none"
                className="h-9 w-full"
                src={`/api/orgs/${orgId}/crm/audio?call=${c.id}`}
              >
                <track kind="captions" />
              </audio>
            )}
          </li>
        ))}
      </ul>
    </SettingsCard>
  );
}
