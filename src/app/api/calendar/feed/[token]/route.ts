import { NextResponse } from "next/server";

import { feedEventsWhereInOrg, icsEventSelect, toIcsEvent } from "@/lib/calendar-feed";
import { buildIcsCalendar, type IcsEvent } from "@/lib/ics";
import { hashIcsToken } from "@/lib/ics-token";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { authDb } from "@/server/db/clients";
import { withSystemOrgTx, withUserTx } from "@/server/db/context";

// Generous: real calendar apps poll this every 15-60 min, but nothing
// legitimate needs more than one request a minute.
const FEED_RATE_LIMIT = 60;
const FEED_RATE_WINDOW_SEC = 60 * 60;
/** Per org: a personal feed is invitations, not a full calendar. */
const PER_ORG_LIMIT = 500;

/** Test seam: the feed's reads (token -> user, user -> orgs, org -> events). */
export const feedReads = {
  async userByTokenHash(tokenHash: string) {
    // app_auth: UserCredential is readable by no tenant role. Only the hash is stored.
    const credential = await authDb.userCredential.findUnique({
      where: { icsTokenHash: tokenHash },
      select: { user: { select: { id: true, name: true } } },
    });
    return credential?.user ?? null;
  },
  async orgsOf(userId: string) {
    // The user's own memberships (app_user, no org context), live orgs only.
    const rows = await withUserTx(userId, ({ db }) =>
      db.membership.findMany({
        where: { userId },
        select: { organization: { select: { id: true, name: true, timezone: true, deletedAt: true } } },
      }),
    );
    return rows.map((r) => r.organization).filter((o) => o.deletedAt === null);
  },
  async eventsIn(userId: string, org: { id: string; timezone: string }): Promise<IcsEvent[]> {
    // Service path scoped to that org; the filter re-checks membership.
    const rows = await withSystemOrgTx(org.id, ({ db }) =>
      db.event.findMany({
        where: feedEventsWhereInOrg(userId, org.id),
        select: icsEventSelect,
        orderBy: [{ startsAt: "asc" }, { id: "asc" }],
        take: PER_ORG_LIMIT,
      }),
    );
    return rows.map((r) => toIcsEvent(r, org.timezone));
  },
};

/**
 * Public, token-authenticated, read-only feed with no session: the token is
 * the credential (unguessable, regenerable in Settings), so calendar apps
 * can subscribe to it. It lists the events the user is invited to, in the
 * orgs they are STILL a member of (0A Fix 7), read org by org on the
 * service path.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // Keyed on a hash of the token: the bucket table never holds the credential.
  const tokenHash = hashIcsToken(token);
  const rateLimit = await checkRateLimit(rateLimitKey("ics-feed", tokenHash), FEED_RATE_LIMIT, FEED_RATE_WINDOW_SEC);
  if (!rateLimit.allowed) {
    return new NextResponse("Too many requests", { status: 429 });
  }

  const user = await feedReads.userByTokenHash(tokenHash);
  if (!user) {
    return new NextResponse("Not found", { status: 404 });
  }

  const events: IcsEvent[] = [];
  for (const org of await feedReads.orgsOf(user.id)) {
    events.push(...(await feedReads.eventsIn(user.id, org)));
  }
  events.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || (a.id < b.id ? -1 : 1));

  const ics = buildIcsCalendar(events, {
    name: `${user.name ?? "Bananasplit"} — Bananasplit`,
    refreshMinutes: 60,
  });

  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}
