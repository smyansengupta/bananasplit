import { ChevronLeft, ListTodo, Pencil } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { majorAndYear, ProfileLinks } from "@/components/profile/profile-links";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BusyGrid } from "@/components/onboarding/availability-editor";
import { UserAvatar } from "@/components/user-avatar";
import { peopleHref, personTasksHref, profileHref } from "@/lib/profile/href";
import { getOrgContextBySlug } from "@/server/db/context";
import { getOrgPerson, getPersonBusyHours } from "@/server/profiles/queries";

/**
 * One member's page (Phase 2). Membership-checked twice: the viewer must be
 * a member of this org (getOrgContextBySlug answers 404 otherwise), and the
 * person must be a CURRENT member of it (getOrgPerson returns null for a
 * user of another org, a former member or an unknown id, and the page
 * answers 404 without saying which). Shows only this org's title.
 */
export default async function PersonPage({ params }: PageProps<"/app/[orgSlug]/people/[userId]">) {
  const { orgSlug, userId } = await params;
  const { organization, user } = await getOrgContextBySlug(orgSlug);
  const person = await getOrgPerson(organization.id, userId);
  if (!person) notFound();

  const isSelf = person.id === user.id;
  // Busy hours, never the reasons. The database decides who may see them
  // (app.member_busy_hours: the org's setting, admins, the person).
  const busy = await getPersonBusyHours(organization.id, person.id);
  const detail = majorAndYear(person.major, person.gradYear);
  const displayName = person.name ?? "Unnamed member";

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <Link
        href={peopleHref(orgSlug)}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        People
      </Link>

      <article className="bg-card space-y-6 rounded-xl p-6 ring-1 ring-foreground/10">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <UserAvatar user={person} size="2xl" decorative={false} />
          <div className="min-w-0 flex-1 space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight break-words">
              {displayName}
              {person.pronouns && (
                <span className="text-muted-foreground ml-2 text-base font-normal">{person.pronouns}</span>
              )}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              {person.title && <Badge variant="secondary">{person.title}</Badge>}
              <span className="text-muted-foreground text-sm">{organization.name}</span>
            </div>
            {detail && <p className="text-muted-foreground text-sm">{detail}</p>}
          </div>
        </header>

        {person.bio ? (
          <section aria-label="Bio">
            <p className="text-sm leading-relaxed whitespace-pre-line">{person.bio}</p>
          </section>
        ) : (
          isSelf && (
            <p className="text-muted-foreground text-sm">
              You haven&apos;t written a bio yet.{" "}
              <Link href={profileHref(orgSlug, "details")} className="text-primary underline-offset-4 hover:underline">
                Add one
              </Link>
              .
            </p>
          )
        )}

        {person.links.length > 0 && (
          <section aria-label="Links">
            <ProfileLinks links={person.links} />
          </section>
        )}

        {busy && busy.length > 0 && (
          <section aria-labelledby="busy-title" className="max-w-sm space-y-2">
            <h2 id="busy-title" className="text-sm font-medium">
              Busy in a typical week
            </h2>
            <BusyGrid busy={busy} />
            <p className="text-muted-foreground text-xs">
              {isSelf ? (
                <>
                  Others see only busy or free.{" "}
                  <Link href={profileHref(orgSlug, "availability")} className="text-primary underline-offset-4 hover:underline">
                    Edit
                  </Link>
                </>
              ) : (
                `Shaded hours ${displayName.split(" ")[0]} can't meet. Times in their own time zone.`
              )}
            </p>
          </section>
        )}

        <footer className="flex flex-wrap items-center gap-2 border-t pt-4">
          <Button asChild variant="outline">
            <Link href={personTasksHref(orgSlug, person.id)}>
              <ListTodo className="size-4" aria-hidden="true" />
              Open tasks
            </Link>
          </Button>
          {isSelf && (
            <Button asChild variant="ghost">
              <Link href={profileHref(orgSlug)}>
                <Pencil className="size-4" aria-hidden="true" />
                Edit your profile
              </Link>
            </Button>
          )}
          <span className="text-muted-foreground ml-auto text-xs">
            Member since{" "}
            {person.joinedAt.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: organization.timezone })}
          </span>
        </footer>
      </article>
    </div>
  );
}
