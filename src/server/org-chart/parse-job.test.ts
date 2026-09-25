// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const { afterCallbacks } = vi.hoisted(() => ({
  afterCallbacks: [] as Array<() => Promise<unknown>>,
}));
vi.mock("next/server", () => ({
  after: (fn: () => Promise<unknown>) => void afterCallbacks.push(fn),
}));
vi.mock("@/server/db/context", () => ({
  assertNoTx: vi.fn(),
  withSystemOrgTx: vi.fn(),
  currentTx: vi.fn(),
  runOutsideTx: (fn: () => unknown) => fn(),
}));

import { matchPerson } from "@/lib/org-chart/match";
import { normalizeOrgChart } from "@/lib/org-chart/normalize";
import { OrgChartParseSchema } from "@/lib/org-chart/schema";
import { scheduleKick } from "@/server/jobs/kick";

import { anthropicClientFactory } from "./claude";
import { chartToWrites } from "./parse-job";
import { titlesFor } from "./service";

const raw = OrgChartParseSchema.parse(
  JSON.parse(
    readFileSync(path.resolve("src/lib/org-chart/__fixtures__/cbc-fall-2026.raw.json"), "utf8"),
  ),
);

afterEach(() => {
  afterCallbacks.length = 0;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the upload request's after()", () => {
  it("only kicks /api/cron/jobs for claude-parse and never calls Claude", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3403");
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const claude = vi.spyOn(anthropicClientFactory, "create");

    scheduleKick("claude-parse", { due: true });
    expect(afterCallbacks).toHaveLength(1);
    await afterCallbacks[0]();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:3403/api/cron/jobs?kind=claude-parse");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer cron-secret");
    expect(claude).not.toHaveBeenCalled();
  });
});

describe("chartToWrites", () => {
  it("attaches suggestions without linking anyone, and none for the open hire", () => {
    const candidates = [
      { userId: "u_jackson", name: "Jackson Lamoureux", emailLocal: "jackson" },
      { userId: "u_oliver", name: "Oliver Ward", emailLocal: "oliver" },
    ];
    const writes = chartToWrites(normalizeOrgChart(raw), candidates);
    const president = writes.find((w) => w.key === "president")!;
    expect(president).toMatchObject({
      userId: null,
      matchState: "SUGGESTED",
      matchScore: 1,
      suggestedUserIds: ["u_jackson"],
      reportsToRef: null,
    });
    expect(writes.find((w) => w.key === "graphic-designer")).toMatchObject({
      isOpen: true,
      matchState: "UNMATCHED",
      suggestedUserIds: [],
    });
    expect(writes.find((w) => w.key === "head-of-tech")?.reportsToRef).toBe("vp-ops-programs");
    expect(matchPerson("Kristine Min", candidates).state).toBe("UNMATCHED");
  });
});

describe("titlesFor", () => {
  it("gives each confirmed member the title of their highest position", () => {
    const rows = [
      {
        id: "p",
        userId: "u1",
        reportsToId: null,
        title: "President",
        rank: "a0",
        matchState: "CONFIRMED" as const,
      },
      {
        id: "t",
        userId: "u1",
        reportsToId: "p",
        title: "Treasurer",
        rank: "a1",
        matchState: "CONFIRMED" as const,
      },
      {
        id: "v",
        userId: "u2",
        reportsToId: "p",
        title: "VP",
        rank: "a2",
        matchState: "CONFIRMED" as const,
      },
      {
        id: "s",
        userId: "u3",
        reportsToId: "p",
        title: "Lead",
        rank: "a3",
        matchState: "SUGGESTED" as const,
      },
    ];
    expect(Object.fromEntries(titlesFor(rows))).toEqual({ u1: "President", u2: "VP" });
  });
});
