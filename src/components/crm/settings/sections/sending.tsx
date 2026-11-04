import Link from "next/link";

import { SettingsCard } from "@/app/app/[orgSlug]/settings/settings-card";
import { AmbientActions } from "@/components/ambient/ambient-button";
import { CrmAvatar } from "@/components/crm/card/crm-card";
import { CircleAlert } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { crmRecordHref } from "@/lib/crm/href";
import { readSending, sendingPauses } from "@/lib/crm/settings-prefs";
import { crmSettingsHref } from "@/lib/crm/settings-sections";
import { failedSends, loadSendingHealth } from "@/server/crm/sending-health";
import { withOrgTx } from "@/server/db/context";

import { SendingPausedView } from "../sending-paused";
import { InboxCard, PaceCard } from "../sending-settings";
import type { SectionProps } from "./types";

const ago = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 60) return `${Math.max(1, mins)} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
};

/**
 * Sending: what's paused and why, whose mailbox mail goes from, the pace
 * (daily cap, hours, weekends), landing in the inbox (SPF, DKIM, the
 * unsubscribe line), and what didn't send lately. In a Personal space it's
 * the same, for one mailbox.
 */
export async function SendingSection({ shell, orgSlug }: SectionProps) {
  const orgId = shell.org.id;
  const [{ health, sender }, failed, settings] = await Promise.all([
    loadSendingHealth(orgId),
    failedSends(orgId),
    withOrgTx(orgId, ({ db }) =>
      db.crmSettings.findUnique({
        where: { organizationId: orgId },
        select: { dailySendCap: true, sending: true },
      }),
    ),
  ]);
  const prefs = readSending(settings?.sending);
  const from = health.senderAddress;
  const people = shell.access.personal
    ? shell.members.filter((m) => m.id === shell.user.id)
    : shell.members;
  return (
    <>
      <SendingPausedView pauses={sendingPauses(health)} orgSlug={orgSlug} />
      <SettingsCard
        title="Mailboxes"
        description={
          shell.access.personal
            ? "Your emails go out with your name, and replies come back to you."
            : "Each member's emails go out with their name, and replies come back to them."
        }
        status={
          <span className="text-muted-foreground text-sm">
            Gmail and Outlook are coming. Until then the sender below is used.{" "}
            <Link
              href={crmSettingsHref(orgSlug, "ai")}
              className="text-foreground underline-offset-2 hover:underline"
            >
              Change it in AI
            </Link>
          </span>
        }
      >
        <ul className="divide-border divide-y">
          {people.slice(0, 50).map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <CrmAvatar name={m.name} size={34} />
              <span className="min-w-0 flex-[1_1_12rem]">
                <b className="block truncate text-[15px] font-semibold">{m.name}</b>
                <span className="text-muted-foreground text-sm">
                  {from
                    ? `Sends as ${m.name} at ${from}`
                    : "Sends through Bananasplit on your behalf"}
                </span>
              </span>
              {sender.ok ? (
                <Badge variant="success">Your sender</Badge>
              ) : (
                <Badge variant="secondary">Bananasplit sender</Badge>
              )}
            </li>
          ))}
        </ul>
        {people.length > 50 && (
          <p className="text-muted-foreground text-sm">
            And {people.length - 50} more, the same way.
          </p>
        )}
      </SettingsCard>
      <PaceCard orgId={orgId} cap={settings?.dailySendCap ?? 150} prefs={prefs} />
      <InboxCard
        orgId={orgId}
        domain={sender.domain}
        verified={sender.ok}
        problem={sender.ok ? null : "Mail may land in spam"}
        unsubscribeLine={prefs.unsubscribeLine}
      />
      <SettingsCard
        id="didnt-send"
        title="Didn't send"
        description="Email and texts from the last two weeks that bounced or didn't go. Everything else went."
      >
        {failed.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing. Every email and text went.</p>
        ) : (
          <ul className="divide-border divide-y">
            {failed.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-3 py-3">
                <CrmAvatar name={f.name} size={40} />
                <span className="min-w-0 flex-[1_1_16rem]">
                  <b className="block text-[15px] font-semibold">{f.name}</b>
                  <span className="text-destructive flex items-start gap-1.5 text-sm">
                    <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                    {f.what}
                  </span>
                </span>
                {f.personId && (
                  <AmbientActions
                    why
                    actions={[
                      {
                        key: "open",
                        label: f.bounced
                          ? "Try another address"
                          : f.channel === "text"
                            ? "See their number"
                            : "Open their card",
                        tone: f.bounced ? "solid" : "outline",
                        reason: `${f.bounced ? "Bounced" : "Didn't go"} ${ago(f.at)}`,
                        href: crmRecordHref(orgSlug, "person", f.personId),
                      },
                    ]}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>
    </>
  );
}
