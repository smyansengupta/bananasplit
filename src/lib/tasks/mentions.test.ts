import { describe, expect, it } from "vitest";

import {
  diffMentions,
  mentionHrefUserId,
  mentionToken,
  mentionsToNotify,
  mentionsToPlainText,
  parseMentionIds,
  parseMentions,
  stripCode,
} from "./mentions";

describe("parseMentions", () => {
  it("finds tokens and dedupes them in order", () => {
    const md = "Hey @[Alex Green](user:u_alex) and @[Oliver Ward](user:u_oliver), @[Alex](user:u_alex) again";
    expect(parseMentionIds(md)).toEqual(["u_alex", "u_oliver"]);
    expect(parseMentions(md)[0]).toEqual({ userId: "u_alex", name: "Alex Green" });
  });

  it("ignores fenced code blocks and inline code", () => {
    const md = [
      "Real: @[Alex](user:u_alex)",
      "```",
      "@[Fake](user:u_fenced)",
      "```",
      "~~~md",
      "@[Tilde](user:u_tilde)",
      "~~~",
      "Inline `@[Code](user:u_inline)` is text",
      "After: @[Smyan](user:u_smyan)",
    ].join("\n");
    expect(parseMentionIds(md)).toEqual(["u_alex", "u_smyan"]);
  });

  it("ignores malformed and hand-typed look-alikes", () => {
    expect(parseMentionIds("@alex, @[Alex](mailto:x), @[Alex](user:bad id), @[](user:u1)")).toEqual([]);
    expect(parseMentionIds(null)).toEqual([]);
  });

  it("stripCode keeps the line structure", () => {
    expect(stripCode("a\n```\nb\n```\nc").split("\n")).toHaveLength(5);
  });
});

describe("mention diffing", () => {
  it("returns added and removed ids", () => {
    expect(diffMentions(["a", "b"], ["b", "c"])).toEqual({ added: ["c"], removed: ["a"] });
  });

  it("notifies only new, non-self mentions", () => {
    expect(mentionsToNotify(["alex"], ["alex", "oliver", "me"], "me")).toEqual(["oliver"]);
    expect(mentionsToNotify(["alex"], ["alex"], "me")).toEqual([]);
    expect(mentionsToNotify([], ["me"], "me")).toEqual([]);
  });
});

describe("tokens", () => {
  it("builds a token that parses back", () => {
    const token = mentionToken("Kristine [Min] (Social)", "u_k");
    expect(token).toBe("@[Kristine Min Social](user:u_k)");
    expect(parseMentionIds(token)).toEqual(["u_k"]);
  });

  it("reads user ids from link targets", () => {
    expect(mentionHrefUserId("user:u_1")).toBe("u_1");
    expect(mentionHrefUserId("javascript:alert(1)")).toBeNull();
    expect(mentionHrefUserId("user:../x")).toBeNull();
  });

  it("renders tokens as plain text", () => {
    expect(mentionsToPlainText("cc @[Alex Green](user:u1) please")).toBe("cc @Alex Green please");
  });
});
