// @vitest-environment node
// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The org switcher, the notification bell and bare /app on the RLS path
 * (0C), against the local seeded database. Skipped without it. The one
 * notification created here is deleted in afterAll.
 */

const { requireUserMock, setCookieMock, activeOrgMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  setCookieMock: vi.fn(),
  activeOrgMock: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock }));
vi.mock("@/lib/active-org-cookie", () => ({
  setActiveOrgCookie: setCookieMock,
  getActiveOrgId: activeOrgMock,
}));

import { authDb, disconnectAll, serviceDb } from "@/server/db/clients";
import { withSystemOrgTx } from "@/server/db/context";

import { switchActiveOrg } from "./actions";
import {
  fetchMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "./notifications-actions";
import AppIndexPage from "./page";

interface Person {
  id: string;
  email: string;
  name: string | null;
}

async function orgIdBySlug(slug: string) {
  const rows = await serviceDb.$queryRaw<{ organizationId: string }[]>`
    SELECT "organizationId" FROM app.resolve_org_slug(${slug})`;
  return rows[0]?.organizationId ?? null;
}

/** Runs a redirecting server function and returns the redirect target. */
async function redirectTarget(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (error) {
    const digest = (error as { digest?: string }).digest ?? "";
    const match = /^NEXT_REDIRECT;[a-z]+;([^;]+);/.exec(digest);
    if (!match) throw error;
    return match[1]!;
  }
}

let seeded: { cbcId: string; roboticsId: string; jackson: Person; kristine: Person } | null = null;
try {
  const cbcId = await orgIdBySlug("claude-builders-club");
  const roboticsId = await orgIdBySlug("robotics-club");
  const users = await authDb.user.findMany({
    where: { email: { in: ["jackson@example.edu", "kristine@example.edu"] } },
    select: { id: true, email: true, name: true },
  });
  const jackson = users.find((u) => u.email === "jackson@example.edu");
  const kristine = users.find((u) => u.email === "kristine@example.edu");
  if (cbcId && roboticsId && jackson && kristine) seeded = { cbcId, roboticsId, jackson, kristine };
} catch {
  seeded = null;
}

describe.skipIf(!seeded)("switcher, bell and /app on the RLS path (seeded CBC)", () => {
  const s = seeded!;
  const notificationId = randomUUID();

  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue(s.kristine);
  });

  afterAll(async () => {
    await withSystemOrgTx(s.cbcId, ({ db }) =>
      db.notification.deleteMany({ where: { id: notificationId } }),
    );
    await disconnectAll();
  });

  it("switchActiveOrg: a member switches (cookie, redirect); a non-member is a no-op", async () => {
    expect(await redirectTarget(() => switchActiveOrg("claude-builders-club"))).toBe(
      "/app/claude-builders-club",
    );
    expect(setCookieMock).toHaveBeenCalledWith(s.cbcId);

    setCookieMock.mockClear();
    expect(await redirectTarget(() => switchActiveOrg("robotics-club"))).toBeNull();
    expect(await redirectTarget(() => switchActiveOrg("no-such-org"))).toBeNull();
    expect(setCookieMock).not.toHaveBeenCalled();
  });

  it("the bell shows and marks only the caller's own notifications", async () => {
    await withSystemOrgTx(s.cbcId, ({ db }) =>
      db.notification.createMany({
        data: [
          {
            id: notificationId,
            organizationId: s.cbcId,
            userId: s.kristine.id,
            type: "TASK_ASSIGNED",
            title: "b9 shell test",
          },
        ],
      }),
    );

    const mine = await fetchMyNotifications();
    expect(mine.notifications.map((n) => n.id)).toContain(notificationId);
    expect(mine.unreadCount).toBeGreaterThanOrEqual(1);

    requireUserMock.mockResolvedValue(s.jackson);
    expect((await fetchMyNotifications()).notifications.map((n) => n.id)).not.toContain(
      notificationId,
    );
    await markNotificationRead(notificationId);
    await markAllNotificationsRead();
    const untouched = await withSystemOrgTx(s.cbcId, ({ db }) =>
      db.notification.findUnique({ where: { id: notificationId }, select: { readAt: true } }),
    );
    expect(untouched?.readAt).toBeNull();

    requireUserMock.mockResolvedValue(s.kristine);
    await markNotificationRead(notificationId);
    const read = await withSystemOrgTx(s.cbcId, ({ db }) =>
      db.notification.findUnique({ where: { id: notificationId }, select: { readAt: true } }),
    );
    expect(read?.readAt).not.toBeNull();
  });

  it("/app goes to the cookie's org only while the user belongs to it", async () => {
    activeOrgMock.mockResolvedValue(s.roboticsId);
    expect(await redirectTarget(() => AppIndexPage())).toBe("/app/claude-builders-club");

    activeOrgMock.mockResolvedValue(s.cbcId);
    expect(await redirectTarget(() => AppIndexPage())).toBe("/app/claude-builders-club");
  });
});
