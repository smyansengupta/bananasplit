// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * A meeting's reminder offsets against the real roles, policies and CHECK
 * constraints of the local database (docs/features/meetings.md): a new
 * meeting takes the organization's default unless it names its own, changing
 * the default never rewrites a meeting that already exists, a bad list is a
 * sentence rather than a constraint violation, and only an ADMIN can change
 * the default. Two throwaway organizations are made as the table owner and
 * removed in afterAll. Skipped when the database is not reachable.
 */

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock, getSession: vi.fn() }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));

import { updateMeetingReminderDefault } from "@/app/app/[orgSlug]/settings/general/actions";
import { ForbiddenError } from "@/lib/auth/errors";
import { authDb, disconnectAll } from "@/server/db/clients";
import { withOrgAction } from "@/server/db/context";
import {
  createEvent,
  EventValidationError,
  updateEvent,
  type EventInput,
  type EventPatch,
} from "@/server/events/service";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

const tag = randomBytes(4).toString("hex");
const orgId = `c_remind_${tag}`;
/** An organization whose OrgSettings row has been deleted, for the fallback. */
const bareOrgId = `c_remindbare_${tag}`;
const DAY = 24 * 60 * 60 * 1000;

let dbReady = false;
try {
  await authDb.$queryRaw`SELECT 1`;
  await ownerDb.$queryRaw`SELECT 1`;
  dbReady = true;
} catch {
  dbReady = false;
}

interface Person {
  id: string;
  email: string;
  name: string | null;
}

let admin: Person;
let member: Person;

async function makeUser(local: string): Promise<Person> {
  return authDb.user.create({
    data: {
      email: `${local}-${tag}@example.edu`,
      name: local,
      emailVerified: new Date(),
      onboardedAt: new Date(),
    },
    select: { id: true, email: true, name: true },
  });
}

const startsAt = new Date(Date.now() + 3 * DAY);
const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);

function input(extra: Partial<EventInput> = {}): EventInput {
  return { title: "Exec sync", startsAt, endsAt, ...extra };
}

/** The event service as the calendar action calls it: a member's action transaction. */
const create = withOrgAction(async (ctx, data: EventInput) => (await createEvent(ctx, data)).event);
const update = withOrgAction(
  async (ctx, eventId: string, patch: EventPatch) => (await updateEvent(ctx, eventId, patch)).event,
);

function storedReminders(eventId: string) {
  return ownerDb.event
    .findFirstOrThrow({ where: { id: eventId }, select: { reminderMinutes: true } })
    .then((row) => row.reminderMinutes);
}

function storedDefault(forOrg = orgId) {
  return ownerDb.orgSettings
    .findUniqueOrThrow({
      where: { organizationId: forOrg },
      select: { meetingReminderMinutes: true },
    })
    .then((row) => row.meetingReminderMinutes);
}

function auditRows(forOrg = orgId) {
  return ownerDb.orgAuditLog.findMany({
    where: { organizationId: forOrg, action: "settings.meeting_reminders_changed" },
    orderBy: { createdAt: "asc" },
    select: { diffJson: true, targetType: true, targetId: true, actorId: true },
  });
}

beforeAll(async () => {
  if (!dbReady) return;
  // Not a try/catch that flips a flag: a database that is up while this
  // file's own setup is broken must fail the run, not pass it unrun.
  admin = await makeUser("remind-admin");
  member = await makeUser("remind-member");
  await ownerDb.organization.create({
    data: { id: orgId, name: "Reminder Test", slug: `remind-${tag}`, timezone: "America/New_York" },
  });
  await ownerDb.organization.create({
    data: { id: bareOrgId, name: "Reminder Bare", slug: `remind-bare-${tag}`, timezone: "UTC" },
  });
  await ownerDb.membership.createMany({
    data: [
      { organizationId: orgId, userId: admin.id, role: "ADMIN" },
      { organizationId: orgId, userId: member.id, role: "MEMBER" },
      { organizationId: bareOrgId, userId: admin.id, role: "ADMIN" },
    ],
  });
});

afterAll(async () => {
  if (dbReady) {
    await ownerDb.job.deleteMany({ where: { organizationId: { in: [orgId, bareOrgId] } } });
    await ownerDb.organization.deleteMany({ where: { id: { in: [orgId, bareOrgId] } } });
    await ownerDb.user.deleteMany({
      where: { id: { in: [admin, member].filter(Boolean).map((u) => u.id) } },
    });
  }
  await disconnectAll();
  await disconnectOwnerDb();
});

describe.skipIf(!dbReady)("reminder offsets against the local database", () => {
  it("the fixture is really there", async () => {
    expect(await storedDefault()).toEqual([1440, 60]);
  });

  it("createEvent without reminderMinutes takes the org default", async () => {
    requireUserMock.mockResolvedValue(admin);
    const event = await create(orgId, input());
    expect(event.reminderMinutes).toEqual([1440, 60]);
    expect(await storedReminders(event.id)).toEqual([1440, 60]);
  });

  it("after updateMeetingReminderDefault([30]) a new event gets [30]", async () => {
    requireUserMock.mockResolvedValue(admin);
    const before = await create(orgId, input({ title: "Made before the change" }));

    expect(await updateMeetingReminderDefault(orgId, [30])).toEqual({});
    expect(await storedDefault()).toEqual([30]);
    const [audit] = await auditRows();
    expect(audit).toMatchObject({
      diffJson: { from: [1440, 60], to: [30] },
      targetType: "OrgSettings",
      targetId: orgId,
      actorId: admin.id,
    });

    const after = await create(orgId, input({ title: "Made after the change" }));
    expect(after.reminderMinutes).toEqual([30]);
    expect(await storedReminders(after.id)).toEqual([30]);
    // The default is for meetings made from now on; it never rewrites one that exists.
    expect(await storedReminders(before.id)).toEqual([1440, 60]);
  });

  it("an explicit [10] wins over the org default", async () => {
    requireUserMock.mockResolvedValue(admin);
    await updateMeetingReminderDefault(orgId, [30]);
    expect(await storedDefault()).toEqual([30]);
    const event = await create(orgId, input({ reminderMinutes: [10] }));
    expect(event.reminderMinutes).toEqual([10]);
    expect(await storedReminders(event.id)).toEqual([10]);
  });

  it("an explicit empty list means no reminders, not the default", async () => {
    requireUserMock.mockResolvedValue(admin);
    const event = await create(orgId, input({ reminderMinutes: [] }));
    expect(event.reminderMinutes).toEqual([]);
    expect(await storedReminders(event.id)).toEqual([]);
  });

  it("stores an unordered list earliest first", async () => {
    requireUserMock.mockResolvedValue(admin);
    const event = await create(orgId, input({ reminderMinutes: [10, 10080, 60] }));
    expect(await storedReminders(event.id)).toEqual([10080, 60, 10]);
  });

  it("an invalid list is an EventValidationError, and no event is made", async () => {
    requireUserMock.mockResolvedValue(admin);
    const title = `Bad reminders ${tag}`;
    const bad: number[][] = [[1, 2, 3, 4, 5, 6, 7, 8, 9], [0], [40321], [1.5], [60, 60]];
    for (const reminderMinutes of bad) {
      await expect(create(orgId, input({ title, reminderMinutes }))).rejects.toBeInstanceOf(
        EventValidationError,
      );
    }
    expect(await ownerDb.event.count({ where: { organizationId: orgId, title } })).toBe(0);
  });

  it("updateEvent changes reminderMinutes", async () => {
    requireUserMock.mockResolvedValue(admin);
    const event = await create(orgId, input({ reminderMinutes: [1440, 60] }));

    const changed = await update(orgId, event.id, { reminderMinutes: [120, 2880] });
    expect(changed.reminderMinutes).toEqual([2880, 120]);
    expect(await storedReminders(event.id)).toEqual([2880, 120]);

    // A patch that does not mention reminders leaves them alone.
    await update(orgId, event.id, { title: "Renamed" });
    expect(await storedReminders(event.id)).toEqual([2880, 120]);

    // An invalid patch is refused, and the stored list stays as it was.
    await expect(update(orgId, event.id, { reminderMinutes: [60, 60] })).rejects.toBeInstanceOf(
      EventValidationError,
    );
    expect(await storedReminders(event.id)).toEqual([2880, 120]);

    // An empty list switches reminders off for this meeting.
    await update(orgId, event.id, { reminderMinutes: [] });
    expect(await storedReminders(event.id)).toEqual([]);
  });

  it("a MEMBER calling updateMeetingReminderDefault is refused, and the default stays", async () => {
    requireUserMock.mockResolvedValue(member);
    const defaultBefore = await storedDefault();
    const auditBefore = (await auditRows()).length;
    await expect(updateMeetingReminderDefault(orgId, [10])).rejects.toBeInstanceOf(ForbiddenError);
    expect(await storedDefault()).toEqual(defaultBefore);
    expect(await auditRows()).toHaveLength(auditBefore);
  });

  it("an organization with no settings row gets one day's and one hour's notice", async () => {
    requireUserMock.mockResolvedValue(admin);
    await ownerDb.orgSettings.delete({ where: { organizationId: bareOrgId } });
    const event = await create(bareOrgId, input());
    expect(event.reminderMinutes).toEqual([1440, 60]);
    expect(await storedReminders(event.id)).toEqual([1440, 60]);
  });
});
