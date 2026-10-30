import { ChevronLeft, ChevronRight } from "@/components/icons";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BackLink } from "@/components/back-link";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/auth/permissions";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { safeTimeZone } from "@/lib/calendar/dates";
import { pulseRangeOf, pulseTitle } from "@/lib/pulse/data";
import { DEFAULT_PULSE_DAY, DEFAULT_PULSE_HOUR } from "@/lib/pulse/settings";
import { isDateKey } from "@/lib/tasks/dates";
import { planGate } from "@/server/billing/plan-gate";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { loadPulseFinance, seesPulseFinance } from "@/server/pulse/finance";
import { getPulseIssue, listPulseIssues, nextPulseLabel } from "@/server/pulse/queries";

import { PulseIssueView } from "../issue-view";
import { PulseNoteForm } from "../note-form";

export async function generateMetadata({ params }: PageProps<"/app/[orgSlug]/pulse/[weekStart]">) {
  const { weekStart } = await params;
  return {
    title: isDateKey(weekStart)
      ? `Weekly pulse: ${pulseTitle(pulseRangeOf(weekStart))}`
      : "Weekly pulse",
  };
}

/**
 * One week's pulse. Members see it once it went out; owners and admins
 * also see this week's draft, with the note they can add before it sends.
 * Finance roles see "Money moved", worked out now and never stored.
 */
export default async function PulseIssuePage({
  params,
}: PageProps<"/app/[orgSlug]/pulse/[weekStart]">) {
  const { orgSlug, weekStart } = await params;
  if (!isDateKey(weekStart)) notFound();
  const locked = await planGate(orgSlug, "overview", { title: "Weekly pulse" });
  if (locked) return locked;
  const { organization: org, role, settings } = await getOrgContextBySlug(orgSlug);
  if (org.kind === "PERSONAL") notFound();
  const isAdmin = can({ role }, "settings.general.write");
  const tz = safeTimeZone(org.timezone);
  const now = new Date();

  const { issue, finance, weeks } = await withOrgTx(org.id, async ({ db }) => {
    const issue = await getPulseIssue(db, org.id, weekStart, { drafts: isAdmin });
    const finance =
      issue && seesPulseFinance(role)
        ? await loadPulseFinance(db, org.id, issue.data.range, tz, now)
        : null;
    // The weeks on either side, so you can step through them from here.
    const weeks = (await listPulseIssues(db, org.id, { drafts: isAdmin })).map((i) => i.weekStart);
    return { issue, finance, weeks };
  }).catch(handleAuthErrorInPage);
  if (!issue) notFound();
  // The archive is newest first: the next index is the week before.
  const at = weeks.indexOf(weekStart);
  const older = at >= 0 ? weeks[at + 1] : undefined;
  const newer = at > 0 ? weeks[at - 1] : undefined;
  const weekHref = (key: string) => `/app/${org.slug}/pulse/${key}`;

  const sendsAt = nextPulseLabel(
    now,
    tz,
    settings?.pulseDay ?? DEFAULT_PULSE_DAY,
    settings?.pulseHourLocal ?? DEFAULT_PULSE_HOUR,
  );
  const status = issue.sentAt
    ? `Sent ${new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: tz }).format(issue.sentAt)}`
    : `Draft, goes out ${sendsAt}`;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <BackLink href={`/app/${org.slug}/pulse`} label="Weekly pulse" />
        <span className="flex gap-1.5">
          <Button
            asChild={Boolean(older)}
            variant="outline"
            size="icon-sm"
            disabled={!older}
            aria-label="The week before"
          >
            {older ? (
              <Link href={weekHref(older)}>
                <ChevronLeft aria-hidden="true" />
              </Link>
            ) : (
              <ChevronLeft aria-hidden="true" />
            )}
          </Button>
          <Button
            asChild={Boolean(newer)}
            variant="outline"
            size="icon-sm"
            disabled={!newer}
            aria-label="The week after"
          >
            {newer ? (
              <Link href={weekHref(newer)}>
                <ChevronRight aria-hidden="true" />
              </Link>
            ) : (
              <ChevronRight aria-hidden="true" />
            )}
          </Button>
        </span>
      </div>
      <PulseIssueView
        clubName={org.name}
        data={issue.data}
        note={issue.note}
        finance={finance}
        status={status}
        noteSlot={
          !issue.sentAt && isAdmin ? (
            <div className="bg-muted/60 rounded-tile p-4">
              <PulseNoteForm
                orgId={org.id}
                issueId={issue.id}
                initial={issue.note}
                sendsAt={sendsAt}
              />
            </div>
          ) : undefined
        }
      />
    </div>
  );
}
