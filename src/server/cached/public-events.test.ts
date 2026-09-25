// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

/**
 * The public feed's cache contract: the loader is stored under the tag built
 * by src/server/cache/tags.ts, the same tag the event service invalidates
 * after a commit that touches a PUBLIC event.
 */

const { cacheCalls } = vi.hoisted(() => ({
  cacheCalls: [] as {
    keyParts: string[];
    tags: string[];
    revalidate: number | false | undefined;
  }[],
}));

vi.mock("next/cache", () => ({
  unstable_cache: (
    fn: () => unknown,
    keyParts: string[],
    options: { tags: string[]; revalidate?: number },
  ) => {
    cacheCalls.push({ keyParts, tags: options.tags, revalidate: options.revalidate });
    return fn;
  },
}));
vi.mock("@/server/db/context", () => ({
  withSystemOrgTx: async (_org: string, fn: (ctx: unknown) => unknown) =>
    fn({
      db: {
        organization: {
          findUnique: async () => ({ name: "CBC", timezone: "UTC", deletedAt: null }),
        },
        event: { findMany: async () => [] },
      },
    }),
}));
const { invalidate } = vi.hoisted(() => ({ invalidate: vi.fn() }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate }));
vi.mock("@/server/audit", () => ({ writeOrgAuditLog: async () => "a" }));
vi.mock("@/server/jobs/enqueue", () => ({ enqueueJob: async () => "j" }));

const { getPublicEvents } = await import("./public-events");
const { createEvent } = await import("@/server/events/service");
const { tags } = await import("@/server/cache/tags");

describe("getPublicEvents cache contract", () => {
  it("is tagged tags.publicEvents(orgId), keyed by org, and revalidates every 5 minutes", async () => {
    expect(await getPublicEvents("org_1")).toEqual({ orgName: "CBC", timeZone: "UTC", events: [] });
    expect(cacheCalls.at(-1)).toEqual({
      keyParts: ["public-events", "org_1"],
      tags: [tags.publicEvents("org_1")],
      revalidate: 300,
    });
  });

  it("uses the same tag the event service invalidates for a PUBLIC event", async () => {
    const db = {
      membership: { count: async () => 1 },
      orgIntegration: { findMany: async () => [] },
      event: {
        create: async ({ data }: { data: Record<string, unknown> }) => ({
          id: "e1",
          googleEventId: null,
          ...data,
        }),
      },
    };
    const ctx = {
      db,
      organizationId: "org_1",
      userId: "u1",
      role: "ADMIN",
      kind: "action",
    } as never;
    const { tags: touched } = await createEvent(ctx, {
      title: "Public workshop",
      startsAt: "2026-10-01T22:00:00Z",
      endsAt: "2026-10-01T23:00:00Z",
      visibility: "PUBLIC",
    });
    expect(touched).toContain(cacheCalls.at(-1)!.tags[0]);
    expect(invalidate).toHaveBeenCalledWith(expect.arrayContaining([tags.publicEvents("org_1")]));
  });
});
