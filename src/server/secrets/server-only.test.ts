// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The contract calls src/server/secrets `server-only`. Until now nothing
 * enforced it: the package was not installed, and the only guard was an
 * ESLint selector that fires solely on a "use client" file importing
 * @/server/secrets or @/server/db — it misses a re-export, a barrel and any
 * client module that reaches a secrets file through another import. The
 * package makes a client import a build error instead.
 */

const dir = path.resolve("src/server/secrets");
const sources = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

describe("the secrets module is server-only", () => {
  it("has server-only as a real dependency", () => {
    const pkg = JSON.parse(readFileSync(path.resolve("package.json"), "utf8"));
    expect(pkg.dependencies["server-only"]).toBeTruthy();
  });

  it("covers every file in the directory", () => {
    expect(sources.toSorted()).toEqual(["envelope.ts", "fingerprint.ts", "index.ts", "keyring.ts"]);
  });

  it.each(sources)("%s imports server-only before anything else", (name) => {
    const lines = readFileSync(path.join(dir, name), "utf8").split(/\r?\n/);
    expect(lines.find((line) => line.startsWith("import "))).toBe('import "server-only";');
  });
});
