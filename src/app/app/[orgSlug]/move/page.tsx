import { ChevronRight } from "@/components/icons";
import Link from "next/link";
import { notFound } from "next/navigation";

import { startClubWithItemAction } from "@/app/onboarding/organization/[orgSlug]/bring-actions";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { orgStepHref } from "@/lib/onboarding/steps";
import { getOrgContextBySlug } from "@/server/db/context";
import { isBringId } from "@/server/personal/bring-cookie";
import { clubsUserRuns } from "@/server/personal/move";

export const metadata = { title: "Move to a club · Bananasplit" };

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

/**
 * Move to a club (docs/features/personal-and-clubs.md): from Personal, pick
 * a club you own or run and you land on its "Bring anything in?" list with
 * ?item ticked; or start a club, and club setup ends on that list with it
 * ticked. Personal only. Link here from an item as
 * /app/{personal slug}/move?item={id}: an event, poll, task, folder, note
 * or file.
 */
export default async function MoveToClubPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/move">) {
  const { orgSlug } = await params;
  const { organization, user } = await getOrgContextBySlug(orgSlug);
  if (organization.kind !== "PERSONAL") notFound();
  const { item } = await searchParams;
  const itemId = isBringId(item) ? item : null;
  const clubs = await clubsUserRuns(user.id);
  const bringHref = (slug: string) => {
    const q = new URLSearchParams({ from: "move" });
    if (itemId) q.set("bring", itemId);
    return `${orgStepHref(slug, "bring")}?${q}`;
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-7.5">
      <div className="space-y-3">
        <PageHeader
          title="Move to a club"
          description={
            clubs.length > 0
              ? `${clubs.length} club${clubs.length === 1 ? "" : "s"} you run${itemId ? " · 1 item picked" : ""}`
              : "You don't run a club yet"
          }
        />
        <p className="text-muted-foreground max-w-prose text-sm">
          Events, polls, tasks, notes and files move one way, with their links, RSVPs, tickets and
          responses. Notes and files arrive private to you.
        </p>
      </div>

      <div className="space-y-4.5">
        {clubs.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Clubs you run</h2>
              </CardTitle>
              <CardDescription>Pick one, then choose what to bring.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-border/70 -mx-2 divide-y">
                {clubs.map((club) => (
                  <li key={club.id}>
                    <Link
                      href={bringHref(club.slug)}
                      className="group hover:bg-muted/60 rounded-field focus-visible:outline-foreground flex items-center gap-3 px-2 py-2.5 text-[15px] font-semibold transition-colors outline-none focus-visible:outline-2"
                    >
                      <span className="bg-muted grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold">
                        {initials(club.name)}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{club.name}</span>
                      <ChevronRight
                        className="text-muted-foreground size-4 shrink-0 transition-transform group-hover:translate-x-0.5"
                        aria-hidden="true"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        <form action={startClubWithItemAction.bind(null, itemId ?? "")}>
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>{clubs.length ? "Or start a new club" : "Start a club"}</h2>
              </CardTitle>
              <CardDescription>
                A new club is free for 30 days. At the end of setup, you choose what to bring in
                {itemId ? ", with this one already picked" : ""}.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex justify-end">
              <Button type="submit" variant={clubs.length ? "outline" : "default"}>
                Start a club
              </Button>
            </CardContent>
          </Card>
        </form>
      </div>
    </div>
  );
}
