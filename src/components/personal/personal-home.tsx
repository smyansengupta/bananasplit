import {
  ArrowRight,
  Bell,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  FolderOpen,
  CircleCheck,
  KeyRound,
  ListChecks,
  MapPin,
  Plus,
  Ticket,
  UserRound,
  Users,
  Vote,
  type IconComponent,
} from "@/components/icons";
import Link from "next/link";
import type { ReactNode } from "react";

import { RSVP_META } from "@/components/calendar/kinds";
import { EmptyState } from "@/components/empty-state";
import { PendingInviteCard } from "@/app/onboarding/pending-invite-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatEventWhen } from "@/lib/calendar/format";
import { PROFILE_STEP_TITLES } from "@/lib/onboarding/steps";
import { orgLogoUrl } from "@/lib/org-logo";
import { DUE_SOON_DAYS, UPCOMING_DAYS } from "@/lib/personal/home-windows";
import { dateTile } from "@/lib/rsvp/when";
import { formatDueKey } from "@/lib/tasks/dates";
import type {
  DueBucket,
  PersonalHomeClub,
  PersonalHomeData,
  ProfileGap,
} from "@/server/personal/home";

import { TileIcon, TileText, tileClass } from "@/components/overview/bits";
import { OverviewStats } from "@/components/overview/overview-stats";
import { UpNext } from "@/components/overview/up-next";
import { FILE_ICONS } from "@/components/notes/file-card";
import { familyOf } from "@/lib/files/types";
import { personalUpNext } from "@/lib/personal/up-next";
import { ago } from "@/lib/relative-time";
import { cn } from "@/lib/utils";
import { orgInitials } from "@/lib/theme/logo";

import { DueTaskRow } from "./due-task-row";
import { PersonalShortcuts } from "./personal-shortcuts";

/**
 * The Personal space's home (/app/{personal slug}): the Personal dashboard
 * of docs/features/personal-and-clubs.md. Invites and "Finish your profile"
 * first, then your clubs, when you meet next and what's due on the left;
 * your RSVPs and polls on the right. It uses the whole width, as a club's
 * Overview does, and every block is the same card (HomeCard: icon, title,
 * a link to its page), so the two columns' headings line up. Every list
 * says what goes in it and how to put something there when it's empty.
 * Data: loadPersonalHome (src/server/personal/home.ts).
 */
export function PersonalHome({
  data,
  orgSlug,
  now = new Date(),
}: {
  data: PersonalHomeData;
  orgSlug: string;
  now?: Date;
}) {
  const base = `/app/${orgSlug}`;
  const dateLine = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: data.timeZone,
  }).format(now);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="page-title">
            {greeting(now, data.timeZone)}
            {data.firstName ? `, ${data.firstName}` : ""}
          </h1>
          <p className="text-muted-foreground mt-2 text-[15px]">
            {dateLine} · Your clubs, plans and to-dos. Only you can see Personal.
          </p>
        </div>
        <PersonalShortcuts base={base} />
      </header>

      <div className="pt-1 pb-2">
        <OverviewStats
          dueSoon={data.dueSoonTotal}
          dueToday={data.dueSoon.filter((t) => t.bucket === "today").length}
          overdue={data.dueSoon.filter((t) => t.bucket === "overdue").length}
          upcoming={data.upcoming.length}
          upcomingDays={UPCOMING_DAYS}
          rsvps={data.rsvps.length}
        />
      </div>

      <UpNext slots={personalUpNext(data, now)} calendarHref={`${base}/calendar`} />

      {data.pendingInvites.length > 0 && (
        <section aria-labelledby="invites-heading" className="space-y-3">
          <SectionTitle id="invites-heading" icon={Bell}>
            {data.pendingInvites.length === 1
              ? "You're invited to a club"
              : `You're invited to ${data.pendingInvites.length} clubs`}
          </SectionTitle>
          <div className="grid gap-3 md:grid-cols-2">
            {data.pendingInvites.map((invitation) => (
              <PendingInviteCard
                key={invitation.id}
                invitation={{
                  id: invitation.id,
                  role: invitation.role,
                  orgName: invitation.orgName,
                }}
              />
            ))}
          </div>
        </section>
      )}

      {data.finishProfileHref && (
        <FinishProfileCard href={data.finishProfileHref} gaps={data.profileGaps} />
      )}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <ClubsSection data={data} now={now} />
          <UpcomingSection data={data} now={now} base={base} />
          <DueSoonSection data={data} base={base} />
        </div>
        <div className="min-w-0 space-y-6">
          <YourWeekCard data={data} base={base} />
          <RsvpsCard data={data} now={now} base={base} />
          <RecentFilesCard data={data} now={now} base={base} />
          <PollsCard data={data} now={now} base={base} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- pieces

function greeting(now: Date, timeZone: string): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone }).format(now),
  );
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function SectionTitle({
  id,
  icon: Icon,
  children,
  action,
}: {
  id: string;
  icon: IconComponent;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 id={id} className="heading flex items-center gap-2 text-base">
        <Icon className="text-muted-foreground size-4" aria-hidden="true" />
        {children}
      </h2>
      {action}
    </div>
  );
}

/**
 * One block of the dashboard: a card with an icon and title, and the page
 * it comes from (or what to do) on the right, as on a club's Overview.
 */
function HomeCard({
  id,
  icon: _icon,
  title,
  action,
  children,
}: {
  id: string;
  icon: IconComponent;
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card role="region" aria-labelledby={id}>
      <CardHeader>
        <CardTitle>
          <h2 id={id} className="flex items-center gap-2">
            {title}
          </h2>
        </CardTitle>
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** A card's link to the page its list comes from. */
function CardLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-muted-foreground text-sm hover:underline">
      {children}
    </Link>
  );
}

/** "Personal" or the club's name, beside an item from that space. */
function SpaceTag({ name }: { name: string }) {
  return (
    <span className="text-muted-foreground inline-flex max-w-40 min-w-0 items-center gap-1.5 text-xs">
      <span className="bg-primary/60 size-1.5 shrink-0 rounded-full" aria-hidden="true" />
      <span className="truncate">{name}</span>
    </span>
  );
}

const GAP_LABEL: Record<ProfileGap, string> = {
  school: "school",
  bio: "bio and links",
  availability: "when you can't meet",
};

function FinishProfileCard({ href, gaps }: { href: string; gaps: ProfileGap[] }) {
  const missing = gaps.map((g) => GAP_LABEL[g]);
  const list =
    missing.length > 1
      ? `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`
      : missing[0];
  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserRound className="text-primary size-4" aria-hidden="true" />
          Finish your profile
        </CardTitle>
        <CardDescription>
          Add your {list}. Clubs you join see your profile, and officers plan meetings around when
          you&apos;re free. A minute or two; skip anything you like.
        </CardDescription>
        <CardAction>
          <Button asChild size="sm">
            <Link href={href}>
              {PROFILE_STEP_TITLES[gaps[0]]}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
    </Card>
  );
}

// ---------------------------------------------------------------- clubs

function ClubsSection({ data, now }: { data: PersonalHomeData; now: Date }) {
  const hasClubs = data.clubs.length > 0;
  return (
    <HomeCard id="clubs-heading" icon={Users} title="Your clubs">
      {hasClubs ? (
        <ul className="grid gap-2.5 sm:grid-cols-2">
          {data.clubs.map((club) => (
            <li key={club.id} className="min-w-0">
              <ClubRow club={club} viewerZone={data.timeZone} now={now} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground max-w-prose text-sm">
          A club shares one calendar, task board and set of polls. Joining is always free: ask an
          officer for your club&apos;s code, or start one and invite your people.
        </p>
      )}
      {data.moreClubs > 0 && (
        <p className="text-muted-foreground pt-2 text-xs">
          And {data.moreClubs} more: switch to them from Personal &amp; clubs in the sidebar.
        </p>
      )}
      <JoinOrStart prominent={!hasClubs} />
    </HomeCard>
  );
}

function roleLine(club: PersonalHomeClub): string {
  const role = club.role.charAt(0) + club.role.slice(1).toLowerCase();
  return club.title ? `${club.title} · ${role}` : role;
}

function ClubRow({
  club,
  viewerZone,
  now,
}: {
  club: PersonalHomeClub;
  viewerZone: string;
  now: Date;
}) {
  const logo = orgLogoUrl(club.logo, 64);
  return (
    <Link href={`/app/${club.slug}`} className={cn(tileClass, "group h-full items-start")}>
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element -- pre-sized WebP variant
        <img src={logo} alt="" width={36} height={36} className="size-9 shrink-0 rounded-full" />
      ) : (
        <TileIcon className="text-xs font-semibold">{orgInitials(club.name)}</TileIcon>
      )}
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[15px] font-semibold">{club.name}</span>
          {club.paused && <Badge variant="secondary">Paused</Badge>}
        </span>
        <span className="text-muted-foreground block truncate text-[13px]">{roleLine(club)}</span>
        <span className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-[13px]">
          <CalendarDays className="size-3.5 shrink-0" aria-hidden="true" />
          {club.nextMeeting ? (
            <span className="truncate">
              <span className="text-foreground">{club.nextMeeting.title}</span>
              {" · "}
              {formatEventWhen(club.nextMeeting, { viewer: viewerZone, org: club.timeZone }, now)}
            </span>
          ) : (
            <span>No meeting on the calendar</span>
          )}
        </span>
        <span className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
          <span className="inline-flex items-center gap-1">
            <ListChecks className="size-3.5" aria-hidden="true" />
            {club.openTasks === 0
              ? "No open tasks"
              : `${club.openTasks} open task${club.openTasks === 1 ? "" : "s"}`}
          </span>
          {club.unread > 0 && (
            <span className="text-foreground inline-flex items-center gap-1 font-medium">
              <span className="bg-brand-accent size-1.5 rounded-full" aria-hidden="true" />
              {club.unread} unread
            </span>
          )}
        </span>
      </span>
      <ArrowRight
        className="text-muted-foreground mt-1 size-4 shrink-0 transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </Link>
  );
}

/**
 * Join with a code, right here (the join page checks it and shows the club
 * first), or start one: the card's last row, under the clubs.
 */
function JoinOrStart({ prominent }: { prominent: boolean }) {
  return (
    <div className="mt-3 space-y-1.5 border-t pt-3">
      <label htmlFor="join-code" className="flex items-center gap-2 text-sm font-medium">
        <KeyRound className="size-4" aria-hidden="true" />
        Join a club
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <form action="/onboarding/join" method="get" className="flex gap-2">
          <Input
            id="join-code"
            name="code"
            placeholder="Invite code"
            autoComplete="off"
            spellCheck={false}
            maxLength={20}
            aria-describedby="join-code-hint"
            className="h-8 w-40 font-mono uppercase placeholder:font-sans placeholder:normal-case"
          />
          <Button type="submit" size="sm" variant={prominent ? "default" : "outline"}>
            Join
          </Button>
        </form>
        <span className="inline-flex items-center gap-2">
          <span className="text-muted-foreground px-1 text-sm">or</span>
          <Button asChild size="sm" variant="ghost">
            <Link href="/onboarding/organization">
              <Plus aria-hidden="true" />
              Start a club
            </Link>
          </Button>
        </span>
      </div>
      <p id="join-code-hint" className="text-muted-foreground text-xs">
        You&apos;ll see the club before you join, and joining is free. A club you start is free for
        30 days.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- when you meet

function UpcomingSection({ data, now, base }: { data: PersonalHomeData; now: Date; base: string }) {
  return (
    <HomeCard
      id="upcoming-heading"
      icon={CalendarDays}
      title="When you meet next"
      action={<CardLink href={`${base}/calendar`}>Calendar</CardLink>}
    >
      {data.upcoming.length === 0 ? (
        <EmptyState
          size="compact"
          className="py-0"
          title={`Nothing in the next ${UPCOMING_DAYS} days`}
          description={
            data.clubs.length > 0
              ? "Meetings and events from your clubs and your own calendar show here, soonest first."
              : "Your own plans and, once you join a club, its meetings and events show here."
          }
          action={
            <Button asChild size="sm" variant="outline">
              <Link href={`${base}/calendar`}>Add something to your calendar</Link>
            </Button>
          }
        />
      ) : (
        <ul className="divide-y">
          {data.upcoming.map((event) => {
            const tile = dateTile(
              event.startsAt,
              event.allDay ? event.space.timeZone : data.timeZone,
            );
            return (
              <li key={`${event.space.id}:${event.id}`}>
                <Link
                  href={event.href}
                  className="hover:bg-accent/50 -mx-2 flex items-center gap-4 rounded-md px-2 py-2.5 transition-colors"
                >
                  <span className="bg-muted grid w-11 shrink-0 place-items-center rounded-lg py-1.5 text-center">
                    <span className="eyebrow text-muted-foreground">{tile.month}</span>
                    <span className="numeral text-xl">{tile.day}</span>
                  </span>
                  <span className="min-w-0 flex-1 space-y-0.5">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{event.title}</span>
                      {event.rsvp && (
                        <span className="text-muted-foreground shrink-0 text-xs">
                          · {RSVP_META[event.rsvp].short}
                        </span>
                      )}
                    </span>
                    <span className="text-muted-foreground block text-xs">
                      {formatEventWhen(
                        event,
                        { viewer: data.timeZone, org: event.space.timeZone },
                        now,
                      )}
                    </span>
                    <span className="text-muted-foreground flex min-w-0 items-center gap-1 text-xs">
                      {/* On a phone the space goes here, leaving the title its row. */}
                      <span className="max-w-32 shrink-0 truncate sm:hidden">
                        {event.space.name} ·
                      </span>
                      {event.tag && <span className="shrink-0">{event.tag.name}</span>}
                      {event.location && (
                        <>
                          <span aria-hidden="true">·</span>
                          <MapPin className="size-3 shrink-0" aria-hidden="true" />
                          <span className="truncate">{event.location}</span>
                        </>
                      )}
                    </span>
                  </span>
                  <span className="hidden sm:contents">
                    <SpaceTag name={event.space.name} />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </HomeCard>
  );
}

// ---------------------------------------------------------------- due soon

const BUCKETS: { key: DueBucket; label: string }[] = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Today" },
  { key: "soon", label: `Next ${DUE_SOON_DAYS - 1} days` },
];

function DueSoonSection({ data, base }: { data: PersonalHomeData; base: string }) {
  const more = data.dueSoonTotal - data.dueSoon.length;
  return (
    <HomeCard
      id="due-heading"
      icon={ListChecks}
      title="Due soon"
      action={<CardLink href={`${base}/tasks`}>Tasks</CardLink>}
    >
      {data.dueSoon.length === 0 ? (
        <EmptyState
          size="compact"
          className="py-0"
          title="Nothing due this week"
          description="Your own tasks and the ones you're on in your clubs show here when they're due within a week, or overdue."
          action={
            <Button asChild size="sm" variant="outline">
              <Link href={`${base}/tasks`}>
                <CircleCheck className="size-4" aria-hidden="true" />
                Add a task
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {BUCKETS.map(({ key, label }) => {
            const tasks = data.dueSoon.filter((t) => t.bucket === key);
            if (tasks.length === 0) return null;
            return (
              <div key={key}>
                <h3
                  className={
                    key === "overdue" ? "eyebrow text-destructive" : "eyebrow text-muted-foreground"
                  }
                >
                  {label}
                </h3>
                <ul className="divide-y">
                  {tasks.map((task) => (
                    <li key={`${task.space.id}:${task.id}`}>
                      <DueTaskRow
                        orgId={task.space.id}
                        taskId={task.id}
                        title={task.title}
                        href={task.href}
                        space={task.space.name}
                        due={key === "today" ? "Today" : formatDueKey(task.dueKey, data.todayKey)}
                        overdue={key === "overdue"}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {more > 0 && (
            <p className="text-muted-foreground text-xs">
              And {more} more.{" "}
              <Link href={`${base}/tasks`} className="hover:underline">
                See your tasks
              </Link>
            </p>
          )}
        </div>
      )}
    </HomeCard>
  );
}

// ---------------------------------------------------------------- your week

/**
 * "Your week" (the Personal pulse): what you finished in the last seven
 * days across Personal and your clubs, and what's due next.
 */
function YourWeekCard({ data, base }: { data: PersonalHomeData; base: string }) {
  const { done, bySpace } = data.yourWeek;
  const max = Math.max(1, ...bySpace.map((s) => s.done));
  return (
    <HomeCard
      id="week-heading"
      icon={CircleCheck}
      title="Your week"
      action={<CardLink href={`${base}/tasks`}>Tasks</CardLink>}
    >
      <div className="space-y-4">
        <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <b className="numeral text-[40px] leading-none">{done}</b>
          <span className="text-muted-foreground text-sm">
            {done === 1 ? "task" : "tasks"} finished in the last 7 days
          </span>
        </p>
        {bySpace.length > 0 ? (
          <ul className="space-y-2.5">
            {bySpace.slice(0, 4).map((s, i) => (
              <li key={s.space.id} className="space-y-1.5">
                <span className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="truncate font-medium">{s.space.name}</span>
                  <span className="font-semibold tabular-nums">{s.done}</span>
                </span>
                <span className="bg-muted block h-2 overflow-hidden rounded-full">
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${(s.done / max) * 100}%`,
                      background: `var(--chart-${(i % 5) + 1})`,
                    }}
                  />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">
            Check off a task in Personal or a club and it counts here.
          </p>
        )}
        <p className="text-muted-foreground text-[13px]">
          {data.dueSoonTotal === 0
            ? "Nothing due in the coming week."
            : `${data.dueSoonTotal} due in the coming week.`}
        </p>
      </div>
    </HomeCard>
  );
}

// ---------------------------------------------------------------- files

function RecentFilesCard({ data, now, base }: { data: PersonalHomeData; now: Date; base: string }) {
  return (
    <HomeCard
      id="files-heading"
      icon={FolderOpen}
      title="Recent files"
      action={<CardLink href={`${base}/notes`}>Files</CardLink>}
    >
      {data.recentFiles.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Upload PDFs, slides and images to Personal&apos;s Files; the newest show here.
        </p>
      ) : (
        <ul className="space-y-2">
          {data.recentFiles.map((f) => {
            const Icon = FILE_ICONS[familyOf(f.contentType)];
            return (
              <li key={f.id}>
                <Link href={f.href} className={tileClass}>
                  <TileIcon>
                    <Icon />
                  </TileIcon>
                  <TileText title={f.name} sub={ago(f.createdAt, now)} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </HomeCard>
  );
}

// ---------------------------------------------------------------- RSVPs

function RsvpsCard({ data, now, base }: { data: PersonalHomeData; now: Date; base: string }) {
  const empty = data.rsvps.length === 0 && data.hosting.length === 0;
  return (
    <HomeCard
      id="rsvps-heading"
      icon={Ticket}
      title="Your RSVPs"
      action={<CardLink href={`${base}/meetings`}>Meetings</CardLink>}
    >
      <div className="space-y-4">
        {empty ? (
          <EmptyState
            size="compact"
            className="py-0"
            title="No RSVPs yet"
            description="Events you sign up for show here with your ticket. Hosting something? Make an event page anyone can RSVP to, no account needed."
            action={
              <Button asChild size="sm" variant="outline">
                <Link href={`${base}/meetings`}>Set up a meeting</Link>
              </Button>
            }
          />
        ) : (
          <>
            {data.rsvps.length > 0 && (
              <div>
                <h3 className="eyebrow text-muted-foreground">Going</h3>
                <ul className="divide-y">
                  {data.rsvps.map((r) => (
                    <li key={r.registrationId} className="flex items-start gap-3 py-2">
                      <span className="min-w-0 flex-1">
                        <Link
                          href={r.pageHref}
                          className="block truncate text-sm font-medium hover:underline"
                        >
                          {r.title}
                        </Link>
                        <span className="text-muted-foreground block text-xs">
                          {formatEventWhen(r, { viewer: data.timeZone, org: r.timeZone }, now)}
                        </span>
                        {r.host && <SpaceTag name={r.host} />}
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        {r.status === "WAITLIST" ? (
                          <Badge variant="secondary">Waitlist</Badge>
                        ) : (
                          <Link
                            href={r.ticketHref}
                            className="text-primary inline-flex items-center gap-1 text-xs font-medium hover:underline"
                          >
                            <Ticket className="size-3.5" aria-hidden="true" />
                            Ticket
                          </Link>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {data.hosting.length > 0 && (
              <div>
                <h3 className="eyebrow text-muted-foreground">You&apos;re hosting</h3>
                <ul className="divide-y">
                  {data.hosting.map((page) => (
                    <li key={page.id}>
                      <Link
                        href={page.manageHref}
                        className="hover:bg-accent/50 -mx-2 flex items-start gap-3 rounded-md px-2 py-2"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{page.title}</span>
                          <span className="text-muted-foreground block text-xs">
                            {formatEventWhen(
                              page,
                              { viewer: data.timeZone, org: data.timeZone },
                              now,
                            )}
                          </span>
                        </span>
                        <span className="shrink-0 text-right text-xs">
                          <span className="block font-medium">
                            {page.going}
                            {page.capacity !== null ? ` / ${page.capacity}` : ""} going
                          </span>
                          {page.waitlist > 0 && (
                            <span className="text-muted-foreground block">
                              {page.waitlist} waitlisted
                            </span>
                          )}
                          {!page.enabled && (
                            <span className="text-muted-foreground block">Page off</span>
                          )}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </HomeCard>
  );
}

// ---------------------------------------------------------------- polls

function closesLine(closesAt: Date | null, now: Date): string {
  if (!closesAt) return "Open";
  const days = Math.ceil((closesAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
  if (days <= 1) return "Closes within a day";
  return `Closes in ${days} days`;
}

function PollsCard({ data, now, base }: { data: PersonalHomeData; now: Date; base: string }) {
  const empty = data.pollsWaiting.length === 0 && data.ownPolls.length === 0;
  return (
    <HomeCard
      id="polls-heading"
      icon={Vote}
      title="Polls"
      action={
        <Button asChild size="xs" variant="outline">
          <Link href={`${base}/calendar/find-a-time/new`}>
            <CalendarClock aria-hidden="true" />
            Find a time
          </Link>
        </Button>
      }
    >
      <div className="space-y-4">
        {empty ? (
          <EmptyState
            size="compact"
            className="py-0"
            title="No polls waiting"
            description="Polls in your clubs that need your answer show here. To find a time with anyone, send a find-a-time poll: they answer from a link, no account needed."
          />
        ) : (
          <>
            {data.pollsWaiting.length > 0 && (
              <div>
                <h3 className="eyebrow text-muted-foreground">Waiting on you</h3>
                <ul className="divide-y">
                  {data.pollsWaiting.map((p) => {
                    const Icon = p.kind === "question" ? Vote : CalendarRange;
                    return (
                      <li key={`${p.space.id}:${p.id}`}>
                        <Link
                          href={p.href}
                          className="hover:bg-accent/50 -mx-2 flex items-start gap-2.5 rounded-md px-2 py-2"
                        >
                          <Icon
                            className="text-muted-foreground mt-0.5 size-4 shrink-0"
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{p.title}</span>
                            <span className="text-muted-foreground block text-xs">
                              {p.kind === "question" ? "Vote" : "Mark when you're free"} ·{" "}
                              {closesLine(p.closesAt, now)}
                            </span>
                          </span>
                          <SpaceTag name={p.space.name} />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {data.ownPolls.length > 0 && (
              <div>
                <h3 className="eyebrow text-muted-foreground">
                  <Link href={`${base}/calendar/find-a-time`} className="hover:underline">
                    Your find-a-time polls
                  </Link>
                </h3>
                <ul className="divide-y">
                  {data.ownPolls.map((p) => (
                    <li key={`${p.space.id}:${p.id}`}>
                      <Link
                        href={p.href}
                        className="hover:bg-accent/50 -mx-2 flex items-start gap-2.5 rounded-md px-2 py-2"
                      >
                        <CalendarRange
                          className="text-muted-foreground mt-0.5 size-4 shrink-0"
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{p.title}</span>
                          <span className="text-muted-foreground block text-xs">
                            {p.respondents === 0 ? "No answers yet" : `${p.respondents} answered`} ·{" "}
                            {closesLine(p.closesAt, now)}
                          </span>
                        </span>
                        <SpaceTag name={p.space.name} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </HomeCard>
  );
}
