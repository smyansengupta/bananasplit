import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PIN_KINDS } from "./pages";

/**
 * Every kind of pin or recent page the app can make must be one the
 * database's checks allow (Pin_kind_known, RecentVisit_kind_known): a kind
 * added here without a migration made pinning a form, and opening one,
 * fail. The latest migration that sets each check is what's in force.
 */
const dir = path.resolve(__dirname, "../../../prisma/migrations");

function kindsIn(constraint: string): string[] {
  let found: string[] | null = null;
  for (const name of readdirSync(dir).sort()) {
    const file = path.join(dir, name, "migration.sql");
    let sql: string;
    try {
      sql = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const at = sql.lastIndexOf(`ADD CONSTRAINT "${constraint}"`);
    if (at < 0) continue;
    const list = /IN \(([^)]*)\)/.exec(sql.slice(at))?.[1] ?? "";
    found = [...list.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
  }
  return found ?? [];
}

describe("pin and recent page kinds", () => {
  it.each(["Pin_kind_known", "RecentVisit_kind_known"])("are all allowed by %s", (constraint) => {
    expect(kindsIn(constraint).sort()).toEqual([...PIN_KINDS].sort());
  });
});
