import { ArrowRight, CalendarDays, Plus, UserRound } from "@/components/icons";
import Link from "next/link";

import { PendingInviteCard } from "@/app/onboarding/pending-invite-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatEventWhen } from "@/lib/calendar/format";
import { orgLogoUrl } from "@/lib/org-logo";
import { orgInitials } from "@/lib/theme/logo";
import { cn } from "@/lib/utils";
import type { PersonalHomeClub, PersonalHomeData, ProfileGap } from "@/server/personal/home";

/**
 * Personal Home's organizations strip, always right under Up next: one
 * card with a row for each organization you're in (who you are there, its
 * next meeting, your open tasks and what's unread, each a way in). Joining
 * by code or starting one sits on the heading's row; with no organization
 * yet, it fills the card instead. Invitations waiting on you and "Finish
 * your profile" sit under it while they apply. Data: loadPersonalHome
 * (src/server/personal/home.ts).
 */
export function OrganizationsStrip({ data, now }: { data: PersonalHomeData; now: Date }) {
  const first = data.clubs.length === 0;
  return (
    <section aria-labelledby="organizations-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="flex items-baseline gap-3">
          <h2 id="organizations-heading" className="heading text-[17px] leading-snug">
            Your organizations
          </h2>
          {data.moreClubs > 0 && (
            <span className="text-muted-foreground text-[13px]">
              And {data.moreClubs} more in the sidebar
            </span>
          )}
        </div>
        {!first && <JoinForm />}
      </div>

      <div className="bg-card edge rounded-tile p-1.5">
        {first ? (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-3.5 py-3">
            <p className="min-w-0 flex-1 text-[14px]">
              <span className="font-semibold">You&apos;re not in an organization yet.</span>{" "}
              <span className="text-muted-foreground">
                Join one with its invite code, or start your own.
              </span>
            </p>
            <JoinForm first />
          </div>
        ) : (
          <ul className="space-y-1">
            {data.clubs.map((club) => (
              <li key={club.id}>
                <OrgRow club={club} viewerZone={data.timeZone} now={now} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {data.pendingInvites.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {data.pendingInvites.map((invitation) => (
            <PendingInviteCard key={invitation.id} invitation={invitation} />
          ))}
        </div>
      )}
      {data.finishProfileHref && (
        <FinishProfile href={data.finishProfileHref} gaps={data.profileGaps} />
      )}
    </section>
  );
}

function roleLine(club: PersonalHomeClub): string {
  const role = club.role.charAt(0) + club.role.slice(1).toLowerCase();
  return club.title ? `${club.title}, ${role}` : role;
}

/** A count and what it counts, like the Today strip's; a way further in. */
function Count({ href, value, label }: { href: string; value: number; label: string }) {
  return (
    <Link
      href={href}
      className="hover:bg-muted relative z-10 -my-1 flex min-w-0 items-baseline gap-1.5 rounded-[10px] px-2 py-1 transition-colors"
    >
      <span
        className={cn("numeral text-[20px] leading-none", value === 0 && "text-muted-foreground")}
      >
        {value}
      </span>
      <span className="text-muted-foreground text-[13px]">{label}</span>
    </Link>
  );
}

function OrgRow({
  club,
  viewerZone,
  now,
}: {
  club: PersonalHomeClub;
  viewerZone: string;
  now: Date;
}) {
  const logo = orgLogoUrl(club.logo, 96);
  const base = `/app/${club.slug}`;
  return (
    <div className="group hover:bg-muted/60 relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-2.5 rounded-[14px] px-3 py-3 transition-colors md:grid-cols-[auto_minmax(0,1.1fr)_minmax(0,1.4fr)_auto_auto] md:gap-x-6">
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element -- pre-sized WebP variant
        <img
          src={logo}
          alt=""
          width={44}
          height={44}
          className="size-11 rounded-[12px] object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className="bg-foreground text-background grid size-11 place-items-center rounded-[12px] text-[13px] font-semibold"
        >
          {orgInitials(club.name)}
        </span>
      )}
      <span className="min-w-0">
        {/* The whole row opens the organization; its counts go further in. */}
        <Link
          href={base}
          className="block truncate text-[15px] font-semibold after:absolute after:inset-0 after:rounded-[inherit]"
        >
          {club.name}
        </Link>
        <span className="text-muted-foreground block truncate text-[13px]">{roleLine(club)}</span>
      </span>

      <span className="col-span-3 flex min-w-0 items-center gap-2.5 text-[13px] md:col-span-1">
        <CalendarDays className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
        {club.nextMeeting ? (
          <span className="min-w-0">
            <span className="block truncate font-medium">{club.nextMeeting.title}</span>
            <span className="text-muted-foreground block truncate">
              {formatEventWhen(club.nextMeeting, { viewer: viewerZone, org: club.timeZone }, now)}
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">No meeting on the calendar</span>
        )}
      </span>

      <span className="col-span-3 -ms-2 flex items-center gap-1 md:col-span-1 md:ms-0">
        <Count
          href={`${base}/tasks?view=list&scope=mine`}
          value={club.openTasks}
          label={club.openTasks === 1 ? "open task" : "open tasks"}
        />
        <Count href={`${base}/inbox`} value={club.unread} label="unread" />
      </span>

      <ArrowRight
        className="text-muted-foreground col-start-3 row-start-1 size-4 transition-transform group-hover:translate-x-0.5 md:col-start-auto md:row-start-auto"
        aria-hidden="true"
      />
    </div>
  );
}

/** Join by code, or start one. */
function JoinForm({ first = false }: { first?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action="/onboarding/join" method="get" className="flex items-center gap-2">
        <label htmlFor="join-code" className="sr-only">
          Invite code
        </label>
        <Input
          id="join-code"
          name="code"
          placeholder="Invite code"
          autoComplete="off"
          spellCheck={false}
          maxLength={20}
          className="h-8 w-32 font-mono uppercase placeholder:font-sans placeholder:normal-case"
        />
        <Button type="submit" size="sm" variant={first ? "default" : "outline"}>
          Join
        </Button>
      </form>
      <Button asChild size="sm" variant="ghost">
        <Link href="/onboarding/organization">
          <Plus aria-hidden="true" />
          Start one
        </Link>
      </Button>
    </div>
  );
}

const GAP_LABEL: Record<ProfileGap, string> = {
  school: "school",
  bio: "bio and links",
  availability: "when you can't meet",
};

function FinishProfile({ href, gaps }: { href: string; gaps: ProfileGap[] }) {
  const missing = gaps.map((g) => GAP_LABEL[g]);
  const list =
    missing.length > 1
      ? `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`
      : missing[0];
  return (
    <p className="bg-muted/60 rounded-tile flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-[14px]">
      <UserRound className="size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 font-medium">Finish your profile: add your {list}.</span>
      <Button asChild size="sm">
        <Link href={href}>Open your profile</Link>
      </Button>
    </p>
  );
}
