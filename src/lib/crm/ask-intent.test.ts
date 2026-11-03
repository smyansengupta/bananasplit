// @vitest-environment node
import { describe, expect, it } from "vitest";

import { askIntent, looksLikeAsk } from "./ask-intent";

describe("what the Ask card does with it", () => {
  it("answers questions", () => {
    expect(askIntent("Who gave last year but not this year?")).toBe("question");
    expect(askIntent("how many open deals do we have")).toBe("question");
    expect(askIntent("Show me donors gone quiet")).toBe("question");
    expect(askIntent("Harbor Light")).toBe("question");
  });

  it("previews changes", () => {
    expect(askIntent("Move Harbor Light to Committed and give it to Kristine")).toBe("change");
    expect(askIntent("give Rosa Diaz to Jackson")).toBe("change");
    expect(askIntent("Set the Millstone amount to 6000")).toBe("change");
  });

  it("reads pasted chats", () => {
    expect(askIntent("Rosa: Ben and I would love to help.\nYou: Great, details by Friday.")).toBe(
      "paste",
    );
    expect(askIntent("[10:42] Rosa Diaz: hi there\n[10:43] Me: hello")).toBe("paste");
    expect(askIntent("line one\nline two\nline three")).toBe("paste");
    expect(askIntent(`Hey! ${"It was lovely to meet you at the fair. ".repeat(8)}`)).toBe("paste");
  });
});

describe("a toolbar search that is really a question", () => {
  it("keeps names and emails as searches", () => {
    expect(looksLikeAsk("Nora Patel")).toBe(false);
    expect(looksLikeAsk("nora@harborlight.org")).toBe(false);
    expect(looksLikeAsk("donor")).toBe(false);
    expect(looksLikeAsk("")).toBe(false);
  });

  it("asks questions, changes and sentences", () => {
    expect(looksLikeAsk("who is going cold?")).toBe(true);
    expect(looksLikeAsk("Who hasn't given this year")).toBe(true);
    expect(looksLikeAsk("move Harbor Light to Committed")).toBe(true);
    expect(looksLikeAsk("everyone we met at the fair last week")).toBe(true);
    expect(looksLikeAsk("Rosa?")).toBe(true);
  });
});
