import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import Form from "next/form";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { majorAndYear } from "@/components/profile/profile-links";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/user-avatar";
import { PinToggle } from "@/components/pins/pins-context";
import { peopleHref, personHref, profileHref } from "@/lib/profile/href";
import { getOrgContextBySlug } from "@/server/db/context";
import { listOrgPeople, parsePageParam, parseSearchParam } from "@/server/profiles/queries";

/**
 * The people directory (Phase 2): every current member of this org, 50 per
 * page, with their picture, pronouns, this org's title, and major and year.
 * Members only (getOrgContextBySlug answers 404 to anyone else).
 */
export default async function PeoplePage({ params, searchParams }: PageProps<"/app/[orgSlug]/people">) {
  const { orgSlug } = await params;
  const query = await searchParams;
  const { organization, user } = await getOrgContextBySlug(orgSlug);

  const q = parseSearchParam(query.q);
  const { people, total, page, pageCount } = await listOrgPeople(organization.id, {
    page: parsePageParam(query.page),
    q,
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">People</h1>
          <p className="text-muted-foreground text-sm">
            {q
              ? `${total} ${total === 1 ? "match" : "matches"} for “${q}”`
              : `${total} ${total === 1 ? "member" : "members"} of ${organization.name}`}
          </p>
        </div>
        <Form action={peopleHref(orgSlug)} className="flex w-full gap-2 sm:w-auto" role="search">
          <label htmlFor="people-search" className="sr-only">
            Search people
          </label>
          <div className="relative w-full sm:w-64">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" aria-hidden="true" />
            <Input
              id="people-search"
              name="q"
              type="search"
              defaultValue={q}
              placeholder="Name, title or major"
              className="pl-8"
              maxLength={80}
            />
          </div>
          <Button type="submit" variant="outline">
            Search
          </Button>
        </Form>
      </header>

      {people.length === 0 ? (
        <EmptyState
          title={q ? "No one matches that search" : "No members yet"}
          description={q ? "Try a name, a title like “VP”, or a major." : undefined}
          action={
            q ? (
              <Button asChild variant="outline" size="sm">
                <Link href={peopleHref(orgSlug)}>Clear search</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {people.map((person) => {
            const detail = majorAndYear(person.major, person.gradYear);
            const isSelf = person.id === user.id;
            return (
              <li key={person.id} className="group relative">
                <PinToggle
                  href={personHref(orgSlug, person.id)}
                  label={person.name ?? "member"}
                  className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                />
                <Link
                  href={personHref(orgSlug, person.id)}
                  className="bg-card hover:bg-accent/50 focus-visible:ring-ring flex h-full items-center gap-3 rounded-xl p-3 ring-1 ring-foreground/10 transition-colors focus-visible:ring-2 focus-visible:outline-none"
                >
                  <UserAvatar user={person} size="lg" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {person.name ?? "Unnamed member"}
                      {person.pronouns && (
                        <span className="text-muted-foreground ml-1.5 text-xs font-normal">{person.pronouns}</span>
                      )}
                      {isSelf && <span className="text-muted-foreground ml-1.5 text-xs font-normal">(you)</span>}
                    </p>
                    {person.title && <p className="truncate text-sm">{person.title}</p>}
                    {detail && <p className="text-muted-foreground truncate text-xs">{detail}</p>}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {pageCount > 1 && (
        <nav aria-label="Pagination" className="flex items-center justify-between gap-2">
          {page > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={peopleHref(orgSlug, { q, page: page - 1 })} rel="prev">
                <ChevronLeft className="size-4" aria-hidden="true" />
                Previous
              </Link>
            </Button>
          ) : (
            <span />
          )}
          <p className="text-muted-foreground text-sm tabular-nums">
            Page {page} of {pageCount}
          </p>
          {page < pageCount ? (
            <Button asChild variant="outline" size="sm">
              <Link href={peopleHref(orgSlug, { q, page: page + 1 })} rel="next">
                Next
                <ChevronRight className="size-4" aria-hidden="true" />
              </Link>
            </Button>
          ) : (
            <span />
          )}
        </nav>
      )}

      <p className="text-muted-foreground text-xs">
        Want to change how you appear?{" "}
        <Link href={profileHref(orgSlug)} className="text-primary underline-offset-4 hover:underline">
          Edit your profile
        </Link>
        .
      </p>
    </div>
  );
}
