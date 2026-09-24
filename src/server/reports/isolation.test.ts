// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The cached-loader rules for src/server/reports (eslint.config.mjs applies
 * them to src/server/cached/**; this directory is checked here): the loader
 * and every report query take explicit arguments and open their own
 * withSystemOrgTx. They never read the request's transaction
 * (AsyncLocalStorage), cookies or headers, never build SQL from text, and
 * never build cache tags by hand.
 */

const DIR = path.resolve(__dirname);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "testing" ? [] : sources(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

const REQUEST_CONTEXT = /\b(currentTx|afterCommitOrNow|withOrgTx|withOrgAction|withUserTx|getOrgContextBySlug)\b/;

describe("src/server/reports stays a cached-loader module", () => {
  const files = sources(DIR);

  it("finds the modules", () => {
    expect(files.map((f) => path.basename(f))).toEqual(
      expect.arrayContaining(["cache.ts", "visibility.ts", "last-session.ts", "ballots.ts", "signups.ts"]),
    );
  });

  for (const file of sources(DIR)) {
    const rel = path.relative(DIR, file);
    // Code only: comments may name what the code must not do.
    const text = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    it(`${rel}: no request context, cookies, headers or raw SQL text`, () => {
      expect(text).not.toMatch(REQUEST_CONTEXT);
      expect(text).not.toMatch(/from "next\/headers"|cookies\(|headers\(/);
      expect(text).not.toMatch(/\$queryRawUnsafe|\$executeRawUnsafe|Prisma\.raw\b/);
      expect(text).not.toMatch(/["'`]org:/);
    });
  }
});
