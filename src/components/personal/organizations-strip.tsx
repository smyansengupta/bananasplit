import {
  ArrowRight,
  CalendarDays,
  Inbox,
  KeyRound,
  ListChecks,
  Plus,
  UserRound,
} from "@/components/icons";
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
 * tile per organization you're in (its next meeting, your open tasks there
 * and what's unread, each a way in), then a tile to join one by code or
 * start one. Invitations waiting on you and "Finish your profile" sit under
 * it while they apply. Data: loadPersonalHome (src/server/personal/home.ts).
 */
export function OrganizationsStrip({ data, now }: { data: PersonalHomeData; now: Date }) {
  return (
    <section aria-labelledby="organizations-heading" className="space-y-3">
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
      {/* A row that scrolls sideways on a phone, like Up next. */}
      <ul className="-mx-4 flex snap-x [scrollbar-width:none] gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-4">
        {data.clubs.map((club) => (
          <li key={club.id} className="w-[78%] shrink-0 snap-start sm:w-auto">
            <OrgTile club={club} viewerZone={data.timeZone} now={now} />
          </li>
        ))}
        <li className="w-[78%] shrink-0 snap-start sm:w-auto">
          <JoinTile first={data.clubs.length === 0} />
        </li>
      </ul>

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

const TILE =
  "bg-card edge rounded-tile flex h-full min-w-0 flex-col gap-2.5 p-4 transition-[box-shadow,transform] duration-200 hover:shadow-e2 motion-safe:hover:-translate-y-0.5";

function roleLine(club: PersonalHomeClub): string {
  const role = club.role.charAt(0) + club.role.slice(1).toLowerCase();
  return club.title ? `${club.title}, ${role}` : role;
}

function OrgTile({
  club,
  viewerZone,
  now,
}: {
  club: PersonalHomeClub;
  viewerZone: string;
  now: Date;
}) {
  const logo = orgLogoUrl(club.logo, 64);
  const base = `/app/${club.slug}`;
  return (
    <div className={cn(TILE, "relative")}>
      <div className="flex items-center gap-3">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- pre-sized WebP variant
          <img src={logo} alt="" width={36} height={36} className="size-9 shrink-0 rounded-full" />
        ) : (
          <span
            aria-hidden="true"
            className="bg-muted grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold"
          >
            {orgInitials(club.name)}
          </span>
        )}
        <span className="min-w-0 flex-1">
          {/* The whole tile opens the organization; its rows go further in. */}
          <Link
            href={base}
            className="block truncate text-[15px] font-semibold after:absolute after:inset-0 after:rounded-[inherit]"
          >
            {club.name}
          </Link>
          <span className="text-muted-foreground block truncate text-[13px]">{roleLine(club)}</span>
        </span>
        <ArrowRight className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
      </div>
      <span className="text-muted-foreground flex min-w-0 items-start gap-1.5 text-[13px]">
        <CalendarDays className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        {club.nextMeeting ? (
          <span className="min-w-0">
            <span className="text-foreground">{club.nextMeeting.title}</span>
            {", "}
            {formatEventWhen(club.nextMeeting, { viewer: viewerZone, org: club.timeZone }, now)}
          </span>
        ) : (
          <span>No meeting on the calendar</span>
        )}
      </span>
      <span className="relative z-10 mt-auto flex flex-wrap items-center gap-2 text-[13px]">
        <Link
          href={`${base}/tasks?view=list&scope=mine`}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <ListChecks className="size-3.5" aria-hidden="true" />
          {club.openTasks === 0
            ? "No open tasks"
            : `${club.openTasks} open task${club.openTasks === 1 ? "" : "s"}`}
        </Link>
        {club.unread > 0 && (
          <Link
            href={`${base}/inbox`}
            className="bg-muted text-foreground hover:bg-muted/70 inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium"
          >
            <Inbox className="size-3.5" aria-hidden="true" />
            {club.unread} unread
          </Link>
        )}
      </span>
    </div>
  );
}

/** Join by code, or start one: the strip's last tile. */
function JoinTile({ first }: { first: boolean }) {
  return (
    <div className={cn(TILE, "border-dashed hover:shadow-none motion-safe:hover:translate-y-0")}>
      <label htmlFor="join-code" className="flex items-center gap-2 text-[15px] font-semibold">
        <KeyRound className="size-4" aria-hidden="true" />
        {first ? "Join your first organization" : "Join another organization"}
      </label>
      <form action="/onboarding/join" method="get" className="flex gap-2">
        <Input
          id="join-code"
          name="code"
          placeholder="Invite code"
          autoComplete="off"
          spellCheck={false}
          maxLength={20}
          className="h-8 min-w-0 flex-1 font-mono uppercase placeholder:font-sans placeholder:normal-case"
        />
        <Button type="submit" size="sm" variant={first ? "default" : "outline"}>
          Join
        </Button>
      </form>
      <Button asChild size="sm" variant="ghost" className="mt-auto self-start">
        <Link href="/onboarding/organization">
          <Plus aria-hidden="true" />
          Start an organization
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
