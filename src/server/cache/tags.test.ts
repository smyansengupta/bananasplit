import { describe, expect, it } from "vitest";

import { isOrgTag, orgTag, tags, TAG_AREAS } from "./tags";

describe("cache tags", () => {
  it("builds the one grammar org:{orgId}:{area}[:{id}]", () => {
    expect(tags.orgChart("org1")).toBe("org:org1:orgchart");
    expect(tags.reports("org1")).toBe("org:org1:reports");
    expect(tags.reports("org1", "last-session")).toBe("org:org1:reports:last-session");
    expect(tags.publicEvents("org1")).toBe("org:org1:public-events");
    expect(tags.theme("org1")).toBe("org:org1:theme");
    expect(tags.databases("org1", "attendance")).toBe("org:org1:databases:attendance");
    expect(tags.members("org1")).toBe("org:org1:members");
  });

  it("refuses ids that would break the grammar", () => {
    expect(() => tags.orgChart("")).toThrow();
    expect(() => tags.orgChart("a:b")).toThrow();
    expect(() => tags.reports("org1", "x y")).toThrow();
    expect(() => orgTag("o".repeat(300), TAG_AREAS.reports)).toThrow();
  });

  it("recognizes its own tags only", () => {
    expect(isOrgTag(tags.publicEvents("abc"))).toBe(true);
    expect(isOrgTag(tags.reports("abc", "r1"))).toBe(true);
    expect(isOrgTag("public-events:abc")).toBe(false);
    expect(isOrgTag("org:abc:unknown-area")).toBe(false);
    expect(isOrgTag("org:abc:reports:x:y")).toBe(false);
  });
});
