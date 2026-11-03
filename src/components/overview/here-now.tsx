"use client";

import { Users } from "@/components/icons";
import Link from "next/link";

import { useLivePeople, type OnlinePeople } from "@/components/shell/presence-store";
import { Badge } from "@/components/ui/badge";
import { UserAvatar, type UserAvatarUser } from "@/components/user-avatar";
import { hereFinding } from "@/lib/overview/here-now";
import { andList } from "@/lib/overview/ownership";
import { ago } from "@/lib/relative-time";
import type { HereNowData } from "@/server/overview/here-now";

import { OpenLink } from "./bits";
import { Insight } from "./connections";

/**
 * Here now (Overview, one column): who's online and the page each has
 * open, linked so you can open the same page, then you, on Home. It follows
 * the shell's heartbeat (PresenceBeat, presence-store.ts) after the first
 * paint, as the members online line under the greeting does. One finding,
 * only when there's a real overlap: someone is on a page you had open
 * lately, or two people are on the same page (src/lib/overview/here-now.ts).
 */

type You = UserAvatarUser & { id: string };

/** The card header's controls: how many are here (live), then ↗ to People's Online filter. */
export function HereNowControls({
  orgId,
  orgSlug,
  initial,
}: {
  orgId: string;
  orgSlug: string;
  initial: OnlinePeople | null;
}) {
  const people = useLivePeople(orgId) ?? initial;
  return (
    <>
      {people && <Badge variant="secondary">{people.count}</Badge>}
      <span className="flex-1" />
      <OpenLink href={`/app/${orgSlug}/people?online=1`} label="Who's online" />
    </>
  );
}

const firstName = (name: string | null) => name?.trim().split(/\s+/)[0] ?? "Someone";

function Dot() {
  return (
    <span
      aria-hidden="true"
      className="bg-success ring-card absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2"
    />
  );
}

export function HereNow({
  orgId,
  orgSlug,
  you,
  initial,
  data,
}: {
  orgId: string;
  orgSlug: string;
  you: You;
  /** onlineNow as the page read it; null when that read failed. */
  initial: OnlinePeople | null;
  data: HereNowData;
}) {
  const people = useLivePeople(orgId) ?? initial;
  const others = people?.faces ?? [];
  const more = Math.max(0, (people?.count ?? 1) - 1 - others.length);
  const now = new Date(data.now);
  const finding = hereFinding(others, data.recent, { now, homeHref: data.homeHref });

  return (
    <div className="space-y-4">
      <ul className="space-y-3">
        {others.map((face) => (
          <li key={face.id} className="flex min-w-0 items-center gap-3">
            <span className="relative shrink-0">
              <UserAvatar user={face} size="md" />
              <Dot />
            </span>
            <span className="min-w-0">
              <Link
                href={`/app/${orgSlug}/people/${face.id}`}
                className="block truncate text-[15px] font-semibold hover:underline"
              >
                {face.name ?? "Member"}
              </Link>
              <span className="text-muted-foreground block truncate text-[13px]">
                {face.where ? (
                  <>
                    In{" "}
                    <Link
                      href={face.where.href}
                      className="text-foreground font-semibold underline underline-offset-2"
                    >
                      {face.where.label}
                    </Link>
                  </>
                ) : (
                  "Online"
                )}
              </span>
            </span>
          </li>
        ))}
        <li className="flex min-w-0 items-center gap-3">
          <span className="relative shrink-0">
            <UserAvatar user={you} size="md" />
            <Dot />
          </span>
          <span className="min-w-0">
            <span className="block text-[15px] font-semibold">You</span>
            <span className="text-muted-foreground block text-[13px]">Home</span>
          </span>
        </li>
      </ul>

      {more > 0 && (
        <Link
          href={`/app/${orgSlug}/people?online=1`}
          className="text-muted-foreground hover:text-foreground block text-[13px] font-medium"
        >
          {more} more online
        </Link>
      )}

      {others.length === 0 && (
        <p className="text-muted-foreground text-sm">Nobody else is here right now.</p>
      )}

      {finding?.kind === "visited" && (
        <Insight icon={Users}>
          <b>{firstName(finding.person.name)}</b> is in{" "}
          <Link href={finding.page.href} className="font-semibold underline underline-offset-2">
            {finding.page.label}
          </Link>
          , which you had open {ago(new Date(finding.visitedAt), now)}. A good moment to ask about
          it.
        </Insight>
      )}
      {finding?.kind === "together" && (
        <Insight icon={Users}>
          <b>{andList(finding.people.map((p) => firstName(p.name)))}</b>{" "}
          {finding.people.length === 2 ? "are both in" : "are all in"}{" "}
          <Link href={finding.page.href} className="font-semibold underline underline-offset-2">
            {finding.page.label}
          </Link>
          .
        </Insight>
      )}
    </div>
  );
}

/**
 * Here now when only you are in, as Ambient draws it: one narrow column.
 * When someone arrives it says so (live), and the next visit to Home gives
 * Here now its full square back.
 */
export function HereNowAlone({
  orgId,
  orgSlug,
  you,
  initial,
}: {
  orgId: string;
  orgSlug: string;
  you: You;
  initial: OnlinePeople | null;
}) {
  const people = useLivePeople(orgId) ?? initial;
  const others = people?.faces ?? [];
  return (
    <div className="flex h-full flex-col items-start gap-3">
      <span className="relative shrink-0">
        <UserAvatar user={you} size="md" />
        <Dot />
      </span>
      {others.length === 0 ? (
        <p className="text-[14px] leading-snug">
          <b>Just you.</b>
        </p>
      ) : (
        <Link
          href={`/app/${orgSlug}/people?online=1`}
          className="text-[14px] leading-snug font-semibold hover:underline"
        >
          {firstName(others[0].name ?? null)}
          {others.length > 1 ? ` and ${others.length - 1} more` : ""} just came in.
        </Link>
      )}
    </div>
  );
}
