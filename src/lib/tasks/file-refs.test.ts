import { describe, expect, it } from "vitest";

import {
  fileHrefRef,
  fileRefHref,
  fileRefToken,
  fileRefsToPlainText,
  hasFileRef,
  parseFileRefs,
  splitFileRefs,
} from "./file-refs";

describe("file references", () => {
  it("writes a token a picker can insert, for an upload and for a note", () => {
    expect(fileRefToken("Budget.xlsx", "file", "f1")).toBe("[Budget.xlsx](file:f1)");
    expect(fileRefToken("Build log", "note", "n1")).toBe("[Build log](note:n1)");
  });

  it("takes the brackets out of a name that would break the token", () => {
    expect(fileRefToken("Notes [draft] (v2).pdf", "file", "f1")).toBe(
      "[Notes draft v2.pdf](file:f1)",
    );
  });

  it("falls back to the kind when nothing is left of the name", () => {
    expect(fileRefToken("()", "file", "f1")).toBe("[file](file:f1)");
  });

  it("reads every distinct reference once, in the order they appear", () => {
    const text = "See [A.pdf](file:f1) and [Log](note:n1), then [A.pdf](file:f1) again";
    expect(parseFileRefs(text)).toEqual([
      { kind: "file", id: "f1", name: "A.pdf" },
      { kind: "note", id: "n1", name: "Log" },
    ]);
  });

  it("tells a file from a note with the same id", () => {
    expect(parseFileRefs("[A](file:x) [B](note:x)")).toHaveLength(2);
  });

  it("ignores ordinary links", () => {
    expect(parseFileRefs("[docs](https://example.com/file:1)")).toEqual([]);
    expect(hasFileRef("[docs](https://example.com)")).toBe(false);
  });

  it("recognises its own link targets and nothing else", () => {
    expect(fileHrefRef("file:abc-1_2")).toEqual({ kind: "file", id: "abc-1_2" });
    expect(fileHrefRef("note:n1")).toEqual({ kind: "note", id: "n1" });
    expect(fileHrefRef("user:u1")).toBeNull();
    expect(fileHrefRef("https://example.com")).toBeNull();
    expect(fileHrefRef(null)).toBeNull();
  });

  it("points an upload at its file page and a note at the note", () => {
    expect(fileRefHref("acme", "file", "f1")).toBe("/app/acme/notes/files/f1");
    expect(fileRefHref("acme", "note", "n1")).toBe("/app/acme/notes/n1");
  });

  it("leaves the name behind in plain text", () => {
    expect(fileRefsToPlainText("Print [Budget.xlsx](file:f1) first")).toBe(
      "Print Budget.xlsx first",
    );
  });

  it("splits a title into its text and its references", () => {
    expect(splitFileRefs("Print [Budget.xlsx](file:f1) twice")).toEqual([
      { kind: "text", text: "Print " },
      { kind: "ref", ref: { kind: "file", id: "f1", name: "Budget.xlsx" } },
      { kind: "text", text: " twice" },
    ]);
  });

  it("splits a title that is nothing but a reference", () => {
    expect(splitFileRefs("[Build log](note:n1)")).toEqual([
      { kind: "ref", ref: { kind: "note", id: "n1", name: "Build log" } },
    ]);
  });

  it("leaves a title with no reference as one run", () => {
    expect(splitFileRefs("Book the room")).toEqual([{ kind: "text", text: "Book the room" }]);
    expect(hasFileRef("Book the room")).toBe(false);
  });
});
