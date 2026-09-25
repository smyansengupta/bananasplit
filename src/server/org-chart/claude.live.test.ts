// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/secrets", () => ({ getSecret: vi.fn() }));
vi.mock("@/server/db/context", () => ({ assertNoTx: vi.fn(), withSystemOrgTx: vi.fn() }));

import { normalizeOrgChart } from "@/lib/org-chart/normalize";

import { DEFAULT_MODEL, parseWithClaude } from "./claude";

/**
 * Opt-in live check against the real Claude API (never in CI):
 *
 *   RUN_LIVE_CLAUDE=1 ANTHROPIC_API_KEY=sk-ant-... pnpm exec vitest run src/server/org-chart/claude.live.test.ts
 *
 * Parses the CBC seed markdown and asserts the structural invariants, and
 * logs the latency so the SDK timeout can be checked against the kind's
 * maxRuntime (250s in the registry). Costs one parse on the given key.
 */

const live = process.env.RUN_LIVE_CLAUDE === "1" && Boolean(process.env.ANTHROPIC_API_KEY);

describe.skipIf(!live)("live Claude parse of the CBC fixture", () => {
  it(
    "returns the CBC structure",
    async () => {
      const text = readFileSync(path.resolve("src/lib/org-chart/__fixtures__/cbc-fall-2026.md"), "utf8");
      const started = Date.now();
      const result = await parseWithClaude({
        config: {
          apiKey: process.env.ANTHROPIC_API_KEY as string,
          model: process.env.CLAUDE_MODEL ?? DEFAULT_MODEL,
          fallbacks: true,
        },
        source: { type: "text", text, format: "markdown" },
        filename: "cbc-fall-2026.md",
        timeoutMs: 200_000,
      });
      console.info(`[live] ${result.model} in ${Date.now() - started} ms`, result.usage);
      const chart = normalizeOrgChart(result.parse);
      expect(chart.positions).toHaveLength(9);
      expect(chart.positions.filter((p) => p.reportsTo === null && !p.isAdvisor)).toHaveLength(1);
      expect(chart.positions.filter((p) => p.isAdvisor).map((p) => p.personName)).toEqual(["Mehr Anand"]);
      expect(chart.positions.filter((p) => p.isOpen)).toHaveLength(1);
      expect(chart.warnings.filter((w) => w.code === "cycle" || w.code === "dangling")).toEqual([]);
    },
    240_000,
  );
});
