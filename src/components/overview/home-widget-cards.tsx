import type { ReactNode } from "react";

import type { Role } from "@/generated/prisma/enums";
import type { OnlineNow } from "@/server/presence";
import type { MainWidgets, OwnTxWidgets } from "@/server/overview/home-widgets";
import type { RecapWeek as RecapWeekData } from "@/server/overview/recap-week-text";

import { Decisions, DecisionsControls } from "./decisions";
import { Deadlines } from "./deadlines";
import { FocusTime, FocusTimeControls } from "./focus-time";
import { HereNow, HereNowControls } from "./here-now";
import { QuickCapture } from "./quick-capture";
import { RecapWeek } from "./recap-week";
import { SinceYouWereHere } from "./since-you-were-here";
import { Votes } from "./votes";
import { WaitingOnOthers } from "./waiting-on-others";
import { WaitingOnYou } from "./waiting-on-you";
import { WhoOwnsWhat, WhoOwnsWhatControls } from "./who-owns-what";
import {
  DeadlinesControls,
  RecapWeekControls,
  SinceYouWereHereControls,
  VotesControls,
  WaitingOnOthersControls,
  WaitingOnYouControls,
} from "./widget-controls";

/**
 * The newer Home widgets' card bodies and header controls, for the page's
 * board (src/app/app/[orgSlug]/page.tsx), from what
 * src/server/overview/home-widgets.ts loaded. A placed widget whose read
 * failed says so in its own card; one added from Add widget has nothing
 * until the board refreshes. Server component code.
 */

export interface HomeWidgetData extends MainWidgets, OwnTxWidgets {
  recap?: RecapWeekData;
}

/** What a card shows when its read failed (not when it's simply empty). */
const FAILED = (
  <p className="text-muted-foreground text-sm">This couldn&apos;t load. Refresh to try again.</p>
);

export function homeWidgetCards({
  orgId,
  orgSlug,
  viewer,
  you,
  online,
  placed,
  data,
}: {
  orgId: string;
  orgSlug: string;
  viewer: { userId: string; role: Role };
  /** The viewer's own face, for Here now when nobody else is on. */
  you: { id: string; name: string | null; image: string | null; avatar: unknown };
  online: OnlineNow | null;
  placed: ReadonlySet<string>;
  data: HomeWidgetData;
}): { bodies: Record<string, ReactNode>; headers: Record<string, ReactNode> } {
  const base = `/app/${orgSlug}`;
  const body = <T,>(type: string, value: T | undefined, render: (value: T) => ReactNode) =>
    value === undefined ? (placed.has(type) ? FAILED : null) : render(value);
  const d = data;
  return {
    bodies: {
      recap: body("recap", d.recap, (v) => <RecapWeek orgId={orgId} data={v} />),
      "since-you-were-here": body("since-you-were-here", d.since, (v) => (
        <SinceYouWereHere orgId={orgId} data={v} />
      )),
      "waiting-on-you": body("waiting-on-you", d.waitingOnYou, (v) => (
        <WaitingOnYou orgId={orgId} data={v} />
      )),
      "waiting-on-others": body("waiting-on-others", d.waitingOnOthers, (v) => (
        <WaitingOnOthers orgId={orgId} data={v} />
      )),
      deadlines: body("deadlines", d.deadlines, (v) => <Deadlines data={v} />),
      "here-now": body("here-now", d.hereNow, (v) => (
        <HereNow orgId={orgId} orgSlug={orgSlug} you={you} initial={online} data={v} />
      )),
      decisions: body("decisions", d.decisions, (v) => (
        <Decisions orgId={orgId} viewer={viewer} data={v} />
      )),
      "who-owns-what": body("who-owns-what", d.owners, (v) => (
        <WhoOwnsWhat orgId={orgId} data={v} />
      )),
      votes: body("votes", d.votes, (v) => <Votes data={v} />),
      "focus-time": body("focus-time", d.focus, (v) => <FocusTime orgId={orgId} data={v} />),
      "quick-capture": body("quick-capture", d.capture, (v) => (
        <QuickCapture orgId={orgId} orgSlug={orgSlug} viewerId={viewer.userId} data={v} />
      )),
    },
    headers: {
      recap: d.recap ? <RecapWeekControls orgSlug={orgSlug} range={d.recap.range} /> : null,
      "since-you-were-here": (
        <SinceYouWereHereControls orgSlug={orgSlug} sinceLabel={d.since?.sinceLabel ?? null} />
      ),
      "waiting-on-you": (
        <WaitingOnYouControls orgSlug={orgSlug} count={d.waitingOnYou?.rows.length ?? 0} />
      ),
      "waiting-on-others": (
        <WaitingOnOthersControls orgSlug={orgSlug} count={d.waitingOnOthers?.rows.length ?? 0} />
      ),
      deadlines: <DeadlinesControls orgSlug={orgSlug} count={d.deadlines?.total ?? 0} />,
      votes: <VotesControls orgSlug={orgSlug} count={d.votes?.total ?? 0} />,
      "here-now": <HereNowControls orgId={orgId} orgSlug={orgSlug} initial={online} />,
      decisions: <DecisionsControls count={d.decisions?.total ?? 0} href={`${base}/meetings`} />,
      "who-owns-what": <WhoOwnsWhatControls data={d.owners ?? null} />,
      "focus-time": <FocusTimeControls calendarHref={`${base}/calendar`} />,
    },
  };
}
