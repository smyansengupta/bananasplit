import { Activity, ChevronRight, Settings2 } from "@/components/icons";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/auth/permissions";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { safeTimeZone } from "@/lib/calendar/dates";
import { pulseHeadline, pulseTitle } from "@/lib/pulse/data";
import { DEFAULT_PULSE_SETTINGS, describePulseSchedule } from "@/lib/pulse/settings";
import { planGate } from "@/server/billing/plan-gate";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { listPulseIssues, nextPulseLabel } from "@/server/pulse/queries";

export const metadata = { title: "Weekly pulse" };

/**
 * The pulse archive (redesign guide 15.2): every week's pulse, newest
 * first. Owners and admins also see this week's draft, to add a note.
 */
export default async function PulseArchivePage({ params }: PageProps<"/app/[orgSlug]/pulse">) {
  const { orgSlug } = await params;
  const locked = await planGate(orgSlug, "overview", { title: "Weekly pulse" });
  if (locked) return locked;
  const { organization: org, role, settings } = await getOrgContextBySlug(orgSlug);
  if (org.kind === "PERSONAL") notFound();
  const isAdmin = can({ role }, "settings.general.write");
  const tz = safeTimeZone(org.timezone);
  const pulse = {
    pulseEnabled: settings?.pulseEnabled ?? DEFAULT_PULSE_SETTINGS.pulseEnabled,
    pulseDay: settings?.pulseDay ?? DEFAULT_PULSE_SETTINGS.pulseDay,
    pulseHourLocal: settings?.pulseHourLocal ?? DEFAULT_PULSE_SETTINGS.pulseHourLocal,
    pulseAudience: settings?.pulseAudience ?? DEFAULT_PULSE_SETTINGS.pulseAudience,
  };
  const issues = await withOrgTx(org.id, ({ db }) =>
    listPulseIssues(db, org.id, { drafts: isAdmin }),
  ).catch(handleAuthErrorInPage);
  const now = new Date();
  const next = nextPulseLabel(now, tz, pulse.pulseDay, pulse.pulseHourLocal);
  const sent = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: tz,
    }).format(d);

  return (
    <div className="space-y-[30px]">
      <PageHeader
        title="Weekly pulse"
        description={
          pulse.pulseEnabled
            ? `What the organization got done each week. ${describePulseSchedule(pulse)}; the next one ${next}.`
            : "The weekly pulse is off for this organization."
        }
        actions={
          isAdmin ? (
            <Button asChild variant="outline">
              <Link href={`/app/${org.slug}/settings/pulse`}>
                <Settings2 className="size-4" aria-hidden="true" />
                Pulse settings
              </Link>
            </Button>
          ) : undefined
        }
      />
      {issues.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No pulse yet"
          description={
            pulse.pulseEnabled
              ? `The first one goes out ${next}: what got done, who came, decisions and next week.`
              : "Turn it on in Admin panel › Weekly pulse to send a short recap every week."
          }
        />
      ) : (
        <ul className="bg-card edge ring-foreground/6 rounded-card overflow-hidden p-2 ring-1">
          {issues.map((issue) => (
            <li key={issue.id}>
              <Link
                href={`/app/${org.slug}/pulse/${issue.weekStart}`}
                className="hover:bg-muted/60 rounded-tile flex items-center gap-4 px-4 py-3.5 transition-colors"
              >
                <span
                  aria-hidden="true"
                  className="bg-muted grid size-10 shrink-0 place-items-center rounded-full"
                >
                  <Activity className="size-[18px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-semibold">
                      {pulseTitle(issue.data.range)}
                    </span>
                    {!issue.sentAt && <Badge variant="accent">Draft</Badge>}
                  </span>
                  <span className="text-muted-foreground block truncate text-sm">
                    {pulseHeadline(issue.data)}
                  </span>
                </span>
                <span className="text-muted-foreground hidden shrink-0 text-[13px] sm:block">
                  {issue.sentAt ? `Sent ${sent(issue.sentAt)}` : `Goes out ${next}`}
                </span>
                <ChevronRight
                  className="text-muted-foreground size-4 shrink-0"
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
