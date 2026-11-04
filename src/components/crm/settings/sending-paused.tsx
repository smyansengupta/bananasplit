import Link from "next/link";

import { CircleAlert } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { sendingPauses, type SendingPause } from "@/lib/crm/settings-prefs";
import { crmSettingsHref } from "@/lib/crm/settings-sections";
import { cn } from "@/lib/utils";
import { loadSendingHealth } from "@/server/crm/sending-health";
import { withOrgTx } from "@/server/db/context";

/**
 * "Sending is paused." (docs/features/crm.md, "Redesign", States): a
 * rounded strip for each thing that stopped, saying why, with the one fix
 * as a link to the settings section that has it. A warning (bounces
 * climbing) reads the same, softer, without "paused". Nothing when
 * everything goes.
 *
 * Any CRM page can show it with one line:
 *   <SendingPausedBanner orgId={shell.org.id} orgSlug={orgSlug} />
 */
export async function SendingPausedBanner({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const { health } = await loadSendingHealth(orgId);
  return <SendingPausedView pauses={sendingPauses(health)} orgSlug={orgSlug} />;
}

/**
 * The banner on the CRM's own pages (Today, People): what stopped, as
 * above, but the missing sender only once group email is actually waiting
 * on it. An organization that never sends group email isn't told on every
 * page; CRM settings, Sending, always says it.
 */
export async function CrmSendingBanner({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const loaded = await loadSendingHealth(orgId).catch(() => null);
  if (!loaded) return null;
  const { health } = loaded;
  let waiting = 0;
  if (!health.senderOk) {
    waiting = await withOrgTx(orgId, ({ db }) =>
      db.crmEmailMessage.count({
        where: {
          organizationId: orgId,
          direction: "OUTBOUND",
          status: { in: ["QUEUED", "SCHEDULED"] },
          OR: [
            { campaignId: { not: null } },
            { enrollmentId: { not: null } },
            { workflowId: { not: null } },
          ],
        },
      }),
    ).catch(() => 0);
  }
  const pauses = sendingPauses({ ...health, senderOk: health.senderOk || waiting === 0 });
  return <SendingPausedView pauses={pauses} orgSlug={orgSlug} />;
}

export function SendingPausedView({
  pauses,
  orgSlug,
}: {
  pauses: SendingPause[];
  orgSlug: string;
}) {
  if (pauses.length === 0) return null;
  return (
    <div className="space-y-2">
      {pauses.map((p) => {
        const paused = p.tone === "paused";
        return (
          <div
            key={p.text}
            role="status"
            className={cn(
              "flex flex-wrap items-center gap-3 rounded-[1.75rem] py-2.5 ps-5 pe-2.5 sm:rounded-full",
              paused
                ? "bg-tint-danger text-tint-danger-foreground"
                : "bg-tint-accent text-tint-accent-foreground",
            )}
          >
            <CircleAlert className="size-[18px] shrink-0" aria-hidden="true" />
            <p className="min-w-0 flex-[1_1_18rem] text-[15px]">
              {paused && <b>Sending is paused. </b>}
              {p.text}
            </p>
            <Button
              asChild
              variant="outline"
              className="bg-card text-foreground hover:bg-card/90 border-transparent"
            >
              <Link
                href={
                  p.fix === "ai"
                    ? crmSettingsHref(orgSlug, "ai")
                    : crmSettingsHref(orgSlug, "sending", "#didnt-send")
                }
              >
                {p.action}
              </Link>
            </Button>
          </div>
        );
      })}
    </div>
  );
}
