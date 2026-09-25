// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cache keys of the report loaders. unstable_cache keys an entry on
 * `${fn.toString()}-${keyParts.join(",")}-${JSON.stringify(args)}`
 * (next/dist/server/web/spec-extension/unstable-cache.js), so the tests
 * capture what getReport hands it and rebuild that string.
 */

const calls = vi.hoisted(
  () =>
    [] as {
      fn: (...a: unknown[]) => unknown;
      keyParts: string[];
      options: unknown;
      args: unknown[];
    }[],
);
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown, keyParts: string[], options: unknown) => {
    return async (...args: unknown[]) => {
      calls.push({ fn, keyParts, options, args });
      return { id: args[0], computedAt: "2026-09-23T00:00:00.000Z", data: { args } };
    };
  },
  updateTag: vi.fn(),
  revalidateTag: vi.fn(),
}));
vi.mock("@/server/db/context", () => ({
  withSystemOrgTx: vi.fn(() => {
    throw new Error("a cache hit must not open a transaction");
  }),
}));

import { reports as reportsTag } from "@/server/cache/tags";

import { clampRefreshSeconds, getReport, reportCacheArgs, type ReportKey } from "./cache";
import { resolveReportRange } from "./range";

const TZ = "America/New_York";
const NOW = new Date("2026-09-23T16:00:00Z");

function keyFor(overrides: Partial<ReportKey> = {}): ReportKey {
  const term = resolveReportRange({}, TZ, NOW);
  return {
    orgId: "org_a",
    tier: "MEMBER",
    from: term.from,
    to: term.to,
    tz: TZ,
    dataVersion: 4,
    settingsStamp: "2026-09-20T00:00:00.000Z",
    ...overrides,
  };
}

/** The key string unstable_cache derives for the last call. */
function lastCacheKey(): string {
  const call = calls.at(-1)!;
  return `${call.fn.toString()}-${call.keyParts.join(",")}-${JSON.stringify(call.args)}`;
}

async function keyOf(id: Parameters<typeof getReport>[0], key: ReportKey): Promise<string> {
  await getReport(id, key, 300);
  return lastCacheKey();
}

describe("report cache keys", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("pass every input as a positional primitive in a fixed order", async () => {
    await getReport("ballots", keyFor(), 300);
    expect(calls[0].keyParts).toEqual(["report", "ballots", "v1"]);
    expect(calls[0].args).toEqual([
      "ballots",
      "org_a",
      "MEMBER",
      "2026-07-01",
      "2026-12-31",
      TZ,
      4,
      "2026-09-20T00:00:00.000Z",
    ]);
    expect(calls[0].args.every((a) => typeof a === "string" || typeof a === "number")).toBe(true);
  });

  it("give member and owner ballot results different keys and payloads", async () => {
    const member = await getReport("ballots", keyFor({ tier: "MEMBER" }), 300);
    const memberKey = lastCacheKey();
    const ownerResult = await getReport("ballots", keyFor({ tier: "OWNER" }), 300);
    const ownerKey = lastCacheKey();
    expect(memberKey).not.toBe(ownerKey);
    expect(member).not.toEqual(ownerResult);
    expect(await keyOf("ballots", keyFor({ tier: "ADMIN" }))).not.toBe(ownerKey);
  });

  it("share one key between the 'this term' preset and the same explicit dates", async () => {
    const preset = resolveReportRange({ range: "term" }, TZ, NOW);
    const custom = resolveReportRange({ from: "2026-07-01", to: "2026-12-31" }, TZ, NOW);
    expect(preset.preset).toBe("term");
    expect(custom.preset).toBe("custom");
    const a = await keyOf("retention", keyFor({ from: preset.from, to: preset.to }));
    const b = await keyOf("retention", keyFor({ from: custom.from, to: custom.to }));
    expect(a).toBe(b);
  });

  it("never share a key between two orgs, two reports or two ranges", async () => {
    const base = await keyOf("attendance", keyFor());
    expect(await keyOf("attendance", keyFor({ orgId: "org_b" }))).not.toBe(base);
    expect(await keyOf("signups", keyFor())).not.toBe(base);
    expect(await keyOf("attendance", keyFor({ from: null, to: null }))).not.toBe(base);
    expect(await keyOf("attendance", keyFor({ tz: "UTC" }))).not.toBe(base);
  });

  it("change when reportsDataVersion is bumped or the settings change", async () => {
    const base = await keyOf("stamps", keyFor());
    expect(await keyOf("stamps", keyFor({ dataVersion: 5 }))).not.toBe(base);
    expect(await keyOf("stamps", keyFor({ settingsStamp: "2026-09-21T00:00:00.000Z" }))).not.toBe(
      base,
    );
  });

  it("tag every entry with the tags.ts reports tags the services invalidate", async () => {
    await getReport("last-session", keyFor(), 300);
    const options = calls[0].options as { tags: string[]; revalidate: number };
    expect(options.tags).toEqual([reportsTag("org_a"), reportsTag("org_a", "last-session")]);
    expect(options.tags[0]).toBe("org:org_a:reports");
    expect(options.revalidate).toBe(300);
  });

  it("revalidate on OrgSettings.reportsRefreshSeconds, clamped", async () => {
    await getReport("attendance", keyFor(), 45);
    expect((calls[0].options as { revalidate: number }).revalidate).toBe(45);
    expect(clampRefreshSeconds(0)).toBe(30);
    expect(clampRefreshSeconds(10_000_000)).toBe(86_400);
    expect(clampRefreshSeconds(Number.NaN)).toBe(300);
  });

  it("write all time as empty strings", () => {
    expect(reportCacheArgs("attendance", keyFor({ from: null, to: null })).slice(3, 5)).toEqual([
      "",
      "",
    ]);
  });
});
