import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { EXPORT_EXCLUDED, EXPORT_TABLES, keysetAfter } from "./registry";
import { signExportDownload, verifyExportDownload } from "./signing";

const schema = readFileSync(path.join(process.cwd(), "prisma", "schema.prisma"), "utf8");

function modelsWithOrgId(): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    if (/^\s+organizationId\s/m.test(m[2])) out.set(m[1], m[2]);
  }
  return out;
}

describe("export registry catalog", () => {
  it("every model with an organizationId is exported or excluded with a reason", () => {
    const registered = new Set([
      ...EXPORT_TABLES.map((t) => t.model),
      ...Object.keys(EXPORT_EXCLUDED),
    ]);
    const missing = [...modelsWithOrgId().keys()].filter((m) => !registered.has(m));
    expect(missing).toEqual([]);
  });

  it("registers only real models, each once, with key and omitted columns that exist", () => {
    const models = modelsWithOrgId();
    const seen = new Set<string>();
    for (const t of EXPORT_TABLES) {
      expect(seen.has(t.model)).toBe(false);
      seen.add(t.model);
      const body = models.get(t.model);
      expect(body, t.model).toBeTruthy();
      for (const col of [...t.key, ...(t.omit ?? [])]) {
        expect(new RegExp(`^\\s+${col}\\s`, "m").test(body!), `${t.model}.${col}`).toBe(true);
      }
    }
  });

  it("never exports ciphertext, and drops secret hashes and storage keys", () => {
    expect(EXPORT_TABLES.some((t) => t.model === "OrgSecret")).toBe(false);
    const omitted = (model: string) => EXPORT_TABLES.find((t) => t.model === model)?.omit ?? [];
    expect(omitted("Invitation")).toContain("token");
    expect(omitted("OrgIntegration")).toContain("secretFingerprint");
    expect(omitted("Receipt")).toContain("blobKey");
    expect(omitted("PollResponse")).toContain("guestKeyHash");
  });

  it("marks individual ballots as privacy-gated", () => {
    expect(
      EXPORT_TABLES.filter((t) => t.ballotRows)
        .map((t) => t.model)
        .sort(),
    ).toEqual(["Ballot", "BallotChoice"]);
  });
});

describe("keysetAfter", () => {
  it("builds a strict tuple comparison", () => {
    expect(keysetAfter(["id"], null)).toEqual({});
    expect(keysetAfter(["id"], { id: "b" })).toEqual({ id: { gt: "b" } });
    expect(keysetAfter(["a", "b"], { a: 1, b: 2 })).toEqual({
      OR: [{ a: { gt: 1 } }, { a: 1, b: { gt: 2 } }],
    });
  });
});

describe("export download signatures", () => {
  const env = { AUTH_SECRET: "test-secret" };
  it("bind the export, the user and the expiry", () => {
    const now = 1_700_000_000_000;
    const link = signExportDownload("exp_1", "user_1", now, env);
    expect(verifyExportDownload("exp_1", "user_1", link.exp, link.sig, now, env)).toBe(true);
    expect(verifyExportDownload("exp_1", "user_2", link.exp, link.sig, now, env)).toBe(false);
    expect(verifyExportDownload("exp_2", "user_1", link.exp, link.sig, now, env)).toBe(false);
    expect(verifyExportDownload("exp_1", "user_1", link.exp + 1, link.sig, now, env)).toBe(false);
    expect(verifyExportDownload("exp_1", "user_1", link.exp, link.sig, link.exp + 1, env)).toBe(
      false,
    );
    expect(
      verifyExportDownload("exp_1", "user_1", link.exp, link.sig, now, { AUTH_SECRET: "other" }),
    ).toBe(false);
  });
});
