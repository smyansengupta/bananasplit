import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/context", async () =>
  (await import("@/test/fake-context")).fakeContextModule(),
);

const { fake, resetFake } = await import("@/test/fake-context");
const { ForbiddenError } = await import("@/lib/auth/errors");
const { switchPlan } = await import("./actions");

const GB = 1024 ** 3;

let kind = "CLUB";
let plan = "TRIAL";
let used = 0;

function makeDb() {
  const space = () => ({
    id: "org_1",
    slug: "robotics",
    name: "Robotics",
    kind,
    plan,
    trialEndsAt: null,
    storageUsedBytes: BigInt(used),
  });
  return {
    organization: {
      findUnique: vi.fn(async () => space()),
      findUniqueOrThrow: vi.fn(async () => space()),
      update: vi.fn(async ({ data }: { data: { plan: string } }) => {
        plan = data.plan;
      }),
    },
    membership: {
      findMany: vi.fn(async () => [{ userId: "owner_1" }, { userId: "admin_1" }]),
    },
    notification: { createMany: vi.fn(async () => ({ count: 2 })) },
    $queryRaw: vi.fn(async () => [{ id: "row" }]),
  };
}

const auditCalls = () =>
  (fake.db.$queryRaw as ReturnType<typeof vi.fn>).mock.calls.filter(([strings]) =>
    (strings as TemplateStringsArray).join("?").includes("write_org_audit"),
  );

beforeEach(() => {
  vi.clearAllMocks();
  kind = "CLUB";
  plan = "TRIAL";
  used = 0;
  resetFake({ role: "OWNER", db: makeDb() });
});

describe("Settings › Plan and storage: a club", () => {
  it("only the OWNER switches plans", async () => {
    for (const role of ["ADMIN", "TREASURER", "MEMBER"]) {
      fake.role = role;
      await expect(switchPlan("org_1", "SOCIETY")).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect(fake.db.organization.update).not.toHaveBeenCalled();
    expect(auditCalls()).toHaveLength(0);
  });

  it("switches at once and records it in the audit log", async () => {
    expect(await switchPlan("org_1", "CLUB")).toEqual({});
    expect(fake.db.organization.update).toHaveBeenCalledWith({
      where: { id: "org_1" },
      data: { plan: "CLUB" },
    });
    const [call] = auditCalls();
    expect(call).toBeDefined();
    const values = call!.slice(1);
    expect(values).toContain("org.plan_changed");
    expect(values).toContain(JSON.stringify({ from: "TRIAL", to: "CLUB", source: "owner" }));
  });

  it("does nothing for the plan the club is already on", async () => {
    plan = "SOCIETY";
    expect(await switchPlan("org_1", "SOCIETY")).toEqual({});
    expect(fake.db.organization.update).not.toHaveBeenCalled();
    expect(auditCalls()).toHaveLength(0);
  });

  it("refuses anything but Free, Team or Team Advanced: no Personal plan, no new trial", async () => {
    for (const p of ["PLATINUM", "club", "FREE", "PERSONAL_PLUS", "TRIAL"]) {
      expect((await switchPlan("org_1", p)).error).toBe("Choose Free, Team or Team Advanced.");
    }
    expect(fake.db.organization.update).not.toHaveBeenCalled();
  });

  it("warns the owners and admins once when a downgrade takes the club past 80%", async () => {
    plan = "SOCIETY";
    used = 42.5 * GB; // 42.5% of Team Advanced's 100 GB, 85% of Team's 50 GB
    expect(await switchPlan("org_1", "CLUB")).toEqual({});
    expect(fake.db.notification.createMany).toHaveBeenCalledTimes(1);
    const { data } = fake.db.notification.createMany.mock.calls[0][0];
    expect(data.map((n: { userId: string }) => n.userId)).toEqual(["owner_1", "admin_1"]);
    expect(data[0].title).toBe("Robotics is using 85% of its storage");
    expect(data[0].linkUrl).toBe("/app/robotics/settings/plan/storage");
  });

  it("lets a downgrade leave the club over its storage (uploads pause; nothing is deleted)", async () => {
    plan = "SOCIETY";
    used = 60 * GB;
    expect(await switchPlan("org_1", "CLUB")).toEqual({});
    expect(plan).toBe("CLUB");
    // Already past 80% of Team Advanced? No: 60%. Past Team's 80%: yes, one notice.
    expect(fake.db.notification.createMany).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when the space stays under 80%", async () => {
    plan = "SOCIETY";
    used = 10 * GB;
    await switchPlan("org_1", "CLUB");
    expect(fake.db.notification.createMany).not.toHaveBeenCalled();
  });
});

describe("Settings › Plan and storage: a Personal space", () => {
  beforeEach(() => {
    kind = "PERSONAL";
    plan = "FREE";
  });

  it("moves between Personal Free and Personal Plus, audit-logged", async () => {
    expect(await switchPlan("org_1", "PERSONAL_PLUS")).toEqual({});
    expect(plan).toBe("PERSONAL_PLUS");
    expect(auditCalls()[0]!.slice(1)).toContain(
      JSON.stringify({ from: "FREE", to: "PERSONAL_PLUS", source: "owner" }),
    );
    expect(await switchPlan("org_1", "FREE")).toEqual({});
    expect(plan).toBe("FREE");
  });

  it("refuses a club's plans and a trial", async () => {
    for (const p of ["CLUB", "SOCIETY", "TRIAL", "plus"]) {
      expect((await switchPlan("org_1", p)).error).toBe("Choose Personal Free or Personal Plus.");
    }
    expect(fake.db.organization.update).not.toHaveBeenCalled();
  });

  it("tells the owner when going back to Free leaves them past 80% of 1 GB", async () => {
    plan = "PERSONAL_PLUS";
    used = Math.round(0.9 * GB);
    await switchPlan("org_1", "FREE");
    const { data } = fake.db.notification.createMany.mock.calls[0][0];
    expect(data[0].title).toBe("Your Personal space is using 90% of its storage");
  });
});
