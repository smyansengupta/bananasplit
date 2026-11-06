import Link from "next/link";

import { SettingsCard } from "@/app/app/[orgSlug]/settings/settings-card";
import { AmbientActions } from "@/components/ambient/ambient-button";
import { RecipeGrid } from "@/components/crm/automations";
import { CrmAvatar } from "@/components/crm/card/crm-card";
import { CircleAlert } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { crmRecordHref } from "@/lib/crm/href";
import { readAutonomy, readSending, sendingPauses } from "@/lib/crm/settings-prefs";
import { crmSettingsHref } from "@/lib/crm/settings-sections";
import { listPlans } from "@/server/crm/outreach/plans";
import { failedSends, loadSendingHealth } from "@/server/crm/sending-health";
import { listRecipes, listWorkflows } from "@/server/crm/workflows";
import { withOrgTx } from "@/server/db/context";

import { RunningCard, TrustCard } from "../automations-settings";
import { NewSeriesButton, SeriesList, SplitListButton, type SeriesRow } from "../follow-up-series";
import { SendingPausedView } from "../sending-paused";
import { SendingCard, UnsubscribeCard } from "../sending-settings";
import { SettingsMore } from "../settings-more";
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
 * Automations and sending: what's paused and why, what runs on its own (each
 * automation opens in place, ?open=automation:<id>; recipes and scores too),
 * the follow-up series and split lists (their cards open over the page,
 * ?open=plan:...), the pace mail goes out at, and what didn't send. How much
 * the CRM may do alone, the unsubscribe line and scores are under More.
 */
export async function AutomationsSection({ shell, orgSlug }: SectionProps) {
  const orgId = shell.org.id;
  const [running, plans, { health, sender }, failed] = await Promise.all([
    withOrgTx(orgId, async ({ db }) => {
      const workflows = await listWorkflows(db, orgId);
      const recipes = workflows.length === 0 ? await listRecipes(db, orgId) : [];
      const settings = await db.crmSettings.findUnique({
        where: { organizationId: orgId },
        select: { autonomy: true, dailySendCap: true, sending: true },
      });
      return { workflows, recipes, settings };
    }),
    withOrgTx(orgId, ({ db }) =>
      listPlans(db, orgId, shell.user.id, {
        relationships: new Map(
          (shell.access.settings?.relationshipTypes ?? []).map((t) => [t.id, t.label]),
        ),
        members: new Map(shell.members.map((m) => [m.id, m.name])),
      }),
    ),
    loadSendingHealth(orgId),
    failedSends(orgId),
  ]);
  const data = { ...running, plans };
  const ready = data.recipes.filter((r) => !r.missing).slice(0, 6);
  const row = (p: (typeof data.plans)[number]): SeriesRow => ({
    type: p.type,
    id: p.id,
    name: p.name,
    status: p.status,
    who: p.who,
    note: p.note,
    ambient: p.ambient,
  });
  const series = data.plans.filter((p) => p.shape === "steps").map(row);
  const lists = data.plans.filter((p) => p.shape !== "steps").map(row);
  const prefs = readSending(data.settings?.sending);
  return (
    <>
      <SendingPausedView pauses={sendingPauses(health)} orgSlug={orgSlug} />
      <RunningCard
        orgId={orgId}
        orgSlug={orgSlug}
        rows={data.workflows.map((w) => ({ ...w, lastRun: w.lastRunAt?.toISOString() ?? null }))}
      />
      {data.workflows.length === 0 && ready.length > 0 && (
        <SettingsCard title="Start from a recipe">
          <RecipeGrid orgId={orgId} orgSlug={orgSlug} recipes={ready} />
        </SettingsCard>
      )}
      <SettingsCard title="Follow-up series" action={<NewSeriesButton orgId={orgId} />}>
        <SeriesList orgId={orgId} rows={series} empty="None yet." />
      </SettingsCard>
      {/* A Personal space has nobody to split a list with: only its group emails. */}
      <SettingsCard
        title={shell.access.personal ? "Group emails" : "Split lists and group emails"}
        action={shell.access.personal ? undefined : <SplitListButton />}
      >
        <SeriesList
          orgId={orgId}
          rows={lists}
          empty="None yet. To email a few people, pick them on People."
        />
      </SettingsCard>
      <SendingCard
        orgId={orgId}
        orgSlug={orgSlug}
        cap={data.settings?.dailySendCap ?? 150}
        prefs={prefs}
        domain={sender.domain}
        verified={sender.ok}
        from={health.senderAddress}
      />
      <span id="didnt-send" className="block scroll-mt-24" />
      {failed.length > 0 && (
        <SettingsCard title="Didn't send">
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
        </SettingsCard>
      )}
      <SettingsMore>
        <TrustCard orgId={orgId} initial={readAutonomy(data.settings?.autonomy)} />
        <UnsubscribeCard orgId={orgId} initial={prefs.unsubscribeLine} />
        <SettingsCard
          title="Scores"
          action={
            <Button variant="outline" size="sm" asChild>
              <Link
                href={crmSettingsHref(orgSlug, "automations", "?open=scoring")}
                scroll={false}
              >
                Open scores
              </Link>
            </Button>
          }
        />
      </SettingsMore>
    </>
  );
}
