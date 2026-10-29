import { CalendarClock, ListTodo, Pencil } from "@/components/icons";
import Link from "next/link";
import type { ReactNode } from "react";

import { majorAndYear, ProfileLinks } from "@/components/profile/profile-links";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TagChip } from "@/components/ui/chip";
import { UserAvatar } from "@/components/user-avatar";
import { personHref, personTasksHref, profileHref } from "@/lib/profile/href";
import { addDaysToKey, formatDueKey } from "@/lib/tasks/dates";
import { cn } from "@/lib/utils";
import type { PersonSheet, SheetPositionRef } from "@/server/profiles/directory";

import { CopyEmailButton } from "./copy-email-button";
import { WeekStrip } from "./week-strip";

/**
 * One member's profile, as the directory's sheet and the full person page
 * show it (Moonstone 12.2): a cover lit by the glow, the 72px avatar, name,
 * pronouns and title, role and team chips, then Copy email (only when the
 * viewer may see it), Find a time, their tasks, and the sections: About,
 * On the org chart, This week, Open tasks, Contact and links, Member since.
 * No hooks: renders on the server (the page) and the client (the sheet).
 */

export const ROLE_LABELS = {
  OWNER: "Owner",
  ADMIN: "Admin",
  TREASURER: "Treasurer",
  MEMBER: "Member",
} as const;

export function teamColor(slot: number): string {
  return `var(--chart-${((slot - 1) % 5) + 1})`;
}

export function dueText(
  dueKey: string,
  todayKey: string,
): { text: string; tone: "danger" | "bold" | "muted" } {
  if (dueKey < todayKey) return { text: formatDueKey(dueKey, todayKey), tone: "danger" };
  if (dueKey === todayKey) return { text: "Today", tone: "danger" };
  if (dueKey === addDaysToKey(todayKey, 1)) return { text: "Tomorrow", tone: "bold" };
  return { text: formatDueKey(dueKey, todayKey), tone: "muted" };
}

export function memberSince(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone });
}

export interface PersonProfileProps {
  person: PersonSheet;
  orgSlug: string;
  viewerId: string;
  /** The org's time zone (Member since). */
  timeZone: string;
  /** The sheet's id for aria-labelledby. */
  headingId?: string;
  headingLevel?: "h1" | "h2";
  /** In the directory: open another person's sheet instead of their page. */
  onSelectPerson?: (userId: string) => void;
  /** Extra actions at the end of the action row (the sheet's ↗ and ×). */
  extraActions?: ReactNode;
  className?: string;
}

export function PersonProfile({
  person,
  orgSlug,
  viewerId,
  timeZone,
  headingId,
  headingLevel = "h2",
  onSelectPerson,
  extraActions,
  className,
}: PersonProfileProps) {
  const name = person.name ?? "Unnamed member";
  const first = name.split(" ")[0];
  const isSelf = person.id === viewerId;
  const Heading = headingLevel;
  const subtitle = [person.pronouns, person.title].filter(Boolean).join(" · ");
  const studies = majorAndYear(person.major, person.gradYear);

  const refLink = (ref: SheetPositionRef) => {
    const label = ref.person ? `${ref.person}, ${ref.title}` : `${ref.title} (open)`;
    if (!ref.userId) return <span key={ref.key}>{label}</span>;
    if (onSelectPerson) {
      const id = ref.userId;
      return (
        <button
          key={ref.key}
          type="button"
          onClick={() => onSelectPerson(id)}
          className="text-left font-medium underline-offset-4 hover:underline"
        >
          {label}
        </button>
      );
    }
    return (
      <Link
        key={ref.key}
        href={personHref(orgSlug, ref.userId)}
        className="font-medium underline-offset-4 hover:underline"
      >
        {label}
      </Link>
    );
  };

  return (
    <div className={cn("flex flex-col", className)}>
      <div
        aria-hidden="true"
        className="bg-muted h-[88px] shrink-0 rounded-t-[inherit] bg-[radial-gradient(70%_160%_at_18%_0%,color-mix(in_oklab,var(--glow)_42%,transparent),transparent_72%)]"
      />
      <div className="-mt-[38px] flex flex-col gap-5 px-[18px] pb-6 sm:px-[22px]">
        <div className="flex items-end justify-between gap-3">
          <span className="relative inline-flex">
            <UserAvatar
              user={person}
              size="xl"
              decorative={false}
              className="ring-raised size-[72px] text-[22px] ring-4"
            />
            {person.freeNow && (
              <span
                aria-hidden="true"
                className="bg-success ring-raised absolute right-0.5 bottom-0.5 size-4 rounded-full ring-[3px]"
              />
            )}
          </span>
        </div>

        <div className="min-w-0">
          <Heading id={headingId} className="display-title text-[23px] break-words">
            {name}
            {isSelf && (
              <span className="text-muted-foreground ml-2 text-sm font-normal">(you)</span>
            )}
          </Heading>
          {subtitle && <p className="text-muted-foreground mt-1 text-sm">{subtitle}</p>}
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary">{ROLE_LABELS[person.role]}</Badge>
            {person.team && (
              <TagChip color={teamColor(person.team.slot)}>{person.team.name}</TagChip>
            )}
            {person.freeNow && <Badge variant="success">Free now</Badge>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {person.email && <CopyEmailButton email={person.email} name={first} />}
          {!isSelf && (
            <Button asChild variant="secondary" size="sm">
              <Link
                href={`/app/${encodeURIComponent(orgSlug)}/calendar/find-a-time/new?with=${encodeURIComponent(person.id)}`}
              >
                <CalendarClock aria-hidden="true" />
                Find a time
              </Link>
            </Button>
          )}
          <Button asChild variant="outline" size="sm">
            <Link href={personTasksHref(orgSlug, person.id)}>
              <ListTodo aria-hidden="true" />
              {isSelf ? "Your tasks" : "Their tasks"}
            </Link>
          </Button>
          {isSelf && (
            <Button asChild variant="ghost" size="sm">
              <Link href={profileHref(orgSlug)}>
                <Pencil aria-hidden="true" />
                Edit your profile
              </Link>
            </Button>
          )}
          {extraActions}
        </div>

        <Section title="About">
          {person.bio ? (
            <p className="text-sm leading-relaxed whitespace-pre-line">{person.bio}</p>
          ) : isSelf ? (
            <p className="text-muted-foreground text-sm">
              You haven&apos;t written a bio yet.{" "}
              <Link
                href={profileHref(orgSlug, "details")}
                className="text-foreground underline underline-offset-4"
              >
                Add one
              </Link>
              .
            </p>
          ) : (
            <p className="text-muted-foreground text-sm">No bio yet.</p>
          )}
        </Section>

        <Section title="On the org chart">
          {person.positions.length === 0 ? (
            <p className="text-muted-foreground text-sm">Not on the org chart yet.</p>
          ) : (
            <dl className="grid grid-cols-[90px_minmax(0,1fr)] gap-x-2.5 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Position</dt>
              <dd className="min-w-0 break-words">
                {person.positions
                  .map((p) => p.title + (p.isAdvisor ? " (advisor)" : ""))
                  .join(", ")}
              </dd>
              <dt className="text-muted-foreground">Reports to</dt>
              <dd className="flex min-w-0 flex-col items-start gap-0.5">
                {person.reportsTo.length
                  ? person.reportsTo.map(refLink)
                  : "No one, top of the chart"}
              </dd>
              {person.alsoReportsTo.length > 0 && (
                <>
                  <dt className="text-muted-foreground">Also reports to</dt>
                  <dd className="flex min-w-0 flex-col items-start gap-0.5">{person.alsoReportsTo.map(refLink)}</dd>
                </>
              )}
              <dt className="text-muted-foreground">Leads</dt>
              <dd className="flex min-w-0 flex-col items-start gap-0.5">
                {person.leads.length ? person.leads.map(refLink) : "No one"}
              </dd>
            </dl>
          )}
        </Section>

        <Section title="This week">
          {person.busy && person.availabilityShared === false ? (
            <p className="text-muted-foreground text-sm">
              {isSelf ? (
                <>
                  You haven&apos;t shared when you&apos;re free.{" "}
                  <Link
                    href={profileHref(orgSlug, "availability")}
                    className="text-foreground underline underline-offset-4"
                  >
                    Add it
                  </Link>
                </>
              ) : (
                `${first} hasn't shared when they're free yet.`
              )}
            </p>
          ) : person.busy ? (
            <>
              <WeekStrip busy={person.busy} />
              <p className="text-muted-foreground text-xs">
                {isSelf ? (
                  <>
                    Others see only busy or free.{" "}
                    <Link
                      href={profileHref(orgSlug, "availability")}
                      className="text-foreground underline underline-offset-4"
                    >
                      Edit
                    </Link>
                  </>
                ) : (
                  `Shaded when ${first} can't meet, in their time zone (${person.timezone.replace(/_/g, " ")}).`
                )}
              </p>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              This organization doesn&apos;t share members&apos; busy times.
            </p>
          )}
        </Section>

        <Section title="Open tasks" count={person.taskCount}>
          {person.tasks.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nothing open.</p>
          ) : (
            <ul className="flex flex-col">
              {person.tasks.map((t) => {
                const due = t.dueKey ? dueText(t.dueKey, person.todayKey) : null;
                return (
                  <li key={t.id} className="flex items-center gap-2.5 py-1.5 text-sm">
                    <span
                      aria-hidden="true"
                      className="border-muted-foreground/50 size-[18px] shrink-0 rounded-full border-[1.5px]"
                    />
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                    {due && (
                      <span
                        className={cn(
                          "shrink-0 text-xs",
                          due.tone === "danger" && "text-tint-danger-foreground",
                          due.tone === "bold" && "font-semibold",
                          due.tone === "muted" && "text-muted-foreground",
                        )}
                      >
                        {due.text}
                      </span>
                    )}
                  </li>
                );
              })}
              {person.taskCount > person.tasks.length && (
                <li className="pt-1 text-sm">
                  <Link
                    href={personTasksHref(orgSlug, person.id)}
                    className="underline underline-offset-4"
                  >
                    See all {person.taskCount}
                  </Link>
                </li>
              )}
            </ul>
          )}
        </Section>

        <Section title="Contact and links">
          <dl className="grid grid-cols-[90px_minmax(0,1fr)] gap-x-2.5 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Email</dt>
            <dd className="min-w-0 break-words">
              {person.email ?? (
                <span className="text-muted-foreground">Only admins see emails here</span>
              )}
            </dd>
            {studies && (
              <>
                <dt className="text-muted-foreground">Studies</dt>
                <dd className="min-w-0">{studies}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Member since</dt>
            <dd>{memberSince(person.joinedAt, timeZone)}</dd>
          </dl>
          {person.links.length > 0 && <ProfileLinks links={person.links} className="pt-1" />}
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-muted-foreground flex items-center gap-2 text-[13px] font-semibold">
        {title}
        {count !== undefined && count > 0 && <Badge variant="secondary">{count}</Badge>}
      </h3>
      {children}
    </section>
  );
}
