import { describe, expect, it } from "vitest";

import { parseRemembered, parseWorkspaceQuery, rememberValue, workspaceHref } from "./views";

describe("the remembered layout and scope", () => {
  it("round-trips through the cookie value", () => {
    expect(parseRemembered(rememberValue("list", "mine"))).toEqual({ view: "list", scope: "mine" });
  });

  it("ignores stale or junk values", () => {
    expect(parseRemembered("week.everyone")).toEqual({ view: undefined, scope: undefined });
    expect(parseRemembered(undefined)).toEqual({});
  });

  it("opens where you left off unless the URL says otherwise", () => {
    const remembered = { view: "list" as const, scope: "mine" as const };
    expect(parseWorkspaceQuery({}, remembered)).toMatchObject({ view: "list", scope: "mine" });
    expect(parseWorkspaceQuery({ view: "table" }, remembered)).toMatchObject({
      view: "table",
      scope: "mine",
    });
    expect(parseWorkspaceQuery({ scope: "all" }, remembered).scope).toBe("all");
    // A deep link to one person steps the scope out of the way.
    expect(parseWorkspaceQuery({ owner: "u1" }, remembered).scope).toBe("all");
  });
});

describe("the No owner filter", () => {
  it("reads and writes ?unowned=1", () => {
    expect(parseWorkspaceQuery({ unowned: "1" }).unowned).toBe(true);
    expect(workspaceHref({ view: "table", unowned: true })).toBe("?view=table&unowned=1");
  });
});
