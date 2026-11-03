import { AlarmClock, Flag, Hourglass, Sparkles, Trophy, Users, type IconComponent } from "@/components/icons";
import Link from "next/link";

import { CrmTabs } from "@/components/crm/crm-tabs";
import { CrmTodayKeys } from "@/components/crm/today-keys";
import { QueueSection } from "@/components/crm/outreach/queue-section";
import { when } from "@/components/crm/record-page";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { crmRecordHref } from "@/lib/crm/href";
import { formatMoney } from "@/lib/crm/fields";
import { todayList, type TodayItem } from "@/server/crm/queries";
import { withOrgTx } from "@/server/db/context";

import { crmShell } from "./shell";

export const metadata = { title: "CRM" };

function daysAgo(days: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

const GROUPS: { kind: TodayItem["kind"]; title: string; empty: string; icon: IconComponent }[] = [
  { kind: "followup", title: "Follow-ups due", empty: "Nobody to follow up with today.", icon: AlarmClock },
  { kind: "cold", title: "Going cold", empty: "Nobody's gone quiet.", icon: Hourglass },
  { kind: "new", title: "New from forms this week", empty: "Nobody new from forms this week.", icon: Sparkles },
  { kind: "stuck", title: "Stuck", empty: "Nothing's stuck.", icon: Hourglass },
  { kind: "nostep", title: "No next step", empty: "Every open item has a next step.", icon: Flag },
];

/**
 * The CRM's home: who to reach out to today (docs/features/crm.md, module 5;
 * Phase 2 grows it into the full follow-up queue). Yours first, or
 * everyone's when nothing is yours.
 */
export default async function CrmHomePage({ params, searchParams }: PageProps<"/app/[orgSlug]/crm">) {
  const { orgSlug } = await params;
  const sp = (await searchParams) as Record<string, string | undefined>;
  const { gate, shell } = await crmShell(orgSlug);
  if (!shell) return gate;
  const orgId = shell.org.id;
  const everyone = sp.who === "all";
  const since = daysAgo(90);
  const data = await withOrgTx(orgId, async ({ db }) => {
    const mine = await todayList(db, orgId, shell.user.id, shell.roles, { mine: true });
    const anyMine = Object.values(mine).some((l) => l.length > 0);
    const lists = everyone || !anyMine ? await todayList(db, orgId, shell.user.id, shell.roles, { mine: false }) : mine;
    const people = await db.crmPerson.count({ where: { organizationId: orgId, deletedAt: null } });
    const open = await db.crmDeal.aggregate({
      where: { organizationId: orgId, deletedAt: null, closedAt: null },
      _count: { _all: true },
      _sum: { amountCents: true },
    });
    const won = await db.crmDeal.count({
      where: {
        organizationId: orgId,
        deletedAt: null,
        stage: { kind: "WON" },
        closedAt: { gte: since },
      },
    });
    return { lists, showingMine: !everyone && anyMine, people, open, won };
  });
  const base = `/app/${orgSlug}/crm`;
  const order = GROUPS.flatMap((g) => data.lists[g.kind].map((i) => i));
  return (
    <div className="space-y-6">
      <PageHeader
        title="Today"
        description={data.showingMine ? "Yours: owned by you or your role." : "Everyone's."}
        actions={
          <Button asChild variant="outline">
            <Link href={data.showingMine ? `${base}?who=all` : base}>{data.showingMine ? "Everyone's" : "Just mine"}</Link>
          </Button>
        }
        tabs={<CrmTabs tabs={shell.tabs} />}
      />
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            [Users, data.people, "People"],
            [Flag, data.open._count._all, "Open items"],
            [AlarmClock, data.lists.followup.length, "Follow-ups due"],
            [Trophy, data.won, "Won, last 90 days"],
          ] as const
        ).map(([Icon, value, label]) => (
          <div key={label} className="bg-card ring-foreground/6 flex items-center gap-3 rounded-2xl px-4 py-3 ring-1">
            <Icon className="text-muted-foreground size-5 shrink-0" aria-hidden="true" />
            <div>
              <dd className="numeral text-[26px] tabular-nums">{value.toLocaleString()}</dd>
              <dt className="text-muted-foreground text-xs">{label}</dt>
            </div>
          </div>
        ))}
      </dl>
      {(data.open._sum.amountCents ?? 0) > 0 && (
        <p className="text-muted-foreground text-sm">{formatMoney(data.open._sum.amountCents)} in open items.</p>
      )}
      <QueueSection orgId={orgId} orgSlug={orgSlug} userId={shell.user.id} roles={shell.roles} members={shell.members} everyone={everyone} />
      <CrmTodayKeys hrefs={order.map((i) => crmRecordHref(orgSlug, i.targetKind, i.id))} />
      <div className="grid gap-4 lg:grid-cols-2">
        {GROUPS.map((g) => {
          const items = data.lists[g.kind];
          const Icon = g.icon;
          return (
            <Card key={g.kind} className="gap-3 p-5">
              <h2 className="heading flex items-center gap-2 text-base">
                <Icon className="text-muted-foreground size-4" aria-hidden="true" />
                {g.title}
                {items.length > 0 && (
                  <span className="bg-foreground/10 text-foreground/70 grid h-[18px] min-w-[18px] place-items-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums">
                    {items.length}
                  </span>
                )}
              </h2>
              {items.length === 0 ? (
                <p className="text-muted-foreground text-sm">{g.empty}</p>
              ) : (
                <ul className="space-y-1">
                  {items.map((i) => (
                    <li key={`${i.targetKind}:${i.id}`}>
                      <Link
                        href={crmRecordHref(orgSlug, i.targetKind, i.id)}
                        data-today-row
                        className="hover:bg-muted focus-visible:bg-muted flex items-baseline gap-2 rounded-lg px-2 py-1.5 text-sm outline-none"
                      >
                        <b className="truncate">{i.title}</b>
                        {i.sub && <span className="text-muted-foreground min-w-0 flex-1 truncate">{i.sub}</span>}
                        {i.at && (
                          <span className="text-muted-foreground ms-auto shrink-0 text-xs tabular-nums">
                            {g.kind === "cold" ? `last ${when(i.at).toLowerCase()}` : when(i.at)}
                          </span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
