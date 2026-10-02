// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rows, getSecret } = vi.hoisted(() => ({
  rows: { value: [] as unknown[] },
  getSecret: vi.fn(),
}));

vi.mock("@/server/db/context", () => ({
  assertNoTx: () => undefined,
  withSystemOrgTx: (_org: string, fn: (ctx: { db: unknown }) => unknown) =>
    fn({ db: { orgIntegration: { findMany: async () => rows.value } } }),
}));
vi.mock("@/server/secrets", () => ({ getSecret }));

import { listAiConnections, platformModel, resolveAiCredentials, standinEnabled } from "./connections";

const claudeRow = {
  provider: "CLAUDE",
  status: "CONNECTED",
  secretFingerprint: "fp1",
  config: { model: "claude-sonnet-5" },
};
const otherRow = {
  provider: "OPENAI_COMPATIBLE",
  status: "CONNECTED",
  secretFingerprint: "fp2",
  config: { vendor: "openai", model: "gpt-4.1-mini" },
};

beforeEach(() => {
  rows.value = [];
  getSecret.mockReset();
});

describe("which models a club can use", () => {
  it("lists the club's own keys first, then the platform's, by label only", async () => {
    rows.value = [otherRow, claudeRow];
    const list = await listAiConnections("org_1", { ANTHROPIC_API_KEY: "sk-ant-platform" });
    expect(list.map((c) => c.id)).toEqual(["claude", "ai-model", "platform"]);
    expect(list[0]).toMatchObject({ label: "Claude Sonnet 5", detail: "Your club's Claude key" });
    expect(list[1].label).toBe("OpenAI · gpt-4.1-mini");
    expect(JSON.stringify(list)).not.toMatch(/sk-|fp1|fp2/);
    expect(getSecret).not.toHaveBeenCalled();
  });

  it("skips a disconnected or keyless integration, and offers nothing when none is set up", async () => {
    rows.value = [{ ...claudeRow, status: "DISCONNECTED" }, { ...otherRow, secretFingerprint: null }];
    expect(await listAiConnections("org_1", {})).toEqual([]);
    expect(await resolveAiCredentials("org_1", null, {})).toBeNull();
  });

  it("decrypts only the chosen key, and falls back to the best one for an unknown choice", async () => {
    rows.value = [claudeRow, otherRow];
    getSecret.mockImplementation(async ({ provider }: { provider: string }) =>
      provider === "CLAUDE" ? "sk-ant-club" : "sk-openai-club-123456",
    );
    const other = await resolveAiCredentials("org_1", "ai-model", {});
    expect(other).toMatchObject({
      protocol: "openai",
      apiKey: "sk-openai-club-123456",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4.1-mini",
    });
    expect(getSecret).toHaveBeenCalledTimes(1);
    const fallback = await resolveAiCredentials("org_1", "made-up", {});
    expect(fallback).toMatchObject({ id: "claude", protocol: "anthropic", apiKey: "sk-ant-club", model: "claude-sonnet-5" });
  });
});

describe("environment switches", () => {
  it("the stand-in is opt-in and never on Vercel", () => {
    expect(standinEnabled({})).toBe(false);
    expect(standinEnabled({ AI_STANDIN: "1" })).toBe(true);
    expect(standinEnabled({ AI_STANDIN: "1", VERCEL: "1" })).toBe(false);
  });

  it("the platform model is a Claude id from the environment, or Sonnet 5", () => {
    expect(platformModel({})).toBe("claude-sonnet-5");
    expect(platformModel({ AI_IMPORT_MODEL: "claude-haiku-4-5-20251001" })).toBe("claude-haiku-4-5-20251001");
    expect(platformModel({ AI_IMPORT_MODEL: "gpt-4o; rm -rf" })).toBe("claude-sonnet-5");
  });
});
