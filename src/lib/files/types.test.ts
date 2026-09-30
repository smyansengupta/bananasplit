import { describe, expect, it } from "vitest";

import { DOCX, familyOf, googleDocId, PPTX, sniffNoteFile } from "./types";

const zip = (part: string) =>
  Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(`....${part}....`, "latin1")]);

describe("sniffNoteFile", () => {
  it("reads the type from the bytes, not the name", () => {
    expect(sniffNoteFile(Buffer.from("%PDF-1.7 ..."), "notes.txt")).toBe("application/pdf");
    expect(sniffNoteFile(zip("word/document.xml"), "x.pdf")).toBe(DOCX);
    expect(sniffNoteFile(zip("ppt/presentation.xml"), "deck.pptx")).toBe(PPTX);
    expect(sniffNoteFile(Buffer.from("# Minutes\n- one"), "minutes.md")).toBe("text/markdown");
    expect(sniffNoteFile(Buffer.from("a,b\n1,2"), "list.csv")).toBe("text/csv");
    expect(sniffNoteFile(Buffer.from("hello"), "hello")).toBe("text/plain");
  });

  it("refuses binaries it does not know, and empty files", () => {
    expect(sniffNoteFile(Buffer.from([0x4d, 0x5a, 0x90, 0x00]), "setup.exe")).toBeNull();
    expect(sniffNoteFile(zip("something/else.xml"), "a.zip")).toBeNull();
    expect(sniffNoteFile(Buffer.alloc(0), "empty.txt")).toBeNull();
    expect(sniffNoteFile(Buffer.from([0xc3, 0x28]), "bad.txt")).toBeNull();
  });

  it("groups types for previews", () => {
    expect(familyOf("image/png")).toBe("image");
    expect(familyOf(DOCX)).toBe("word");
    expect(familyOf("text/csv")).toBe("text");
  });
});

describe("googleDocId", () => {
  it("takes only docs.google.com document links", () => {
    const id = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
    expect(googleDocId(`https://docs.google.com/document/d/${id}/edit?usp=sharing`)).toBe(id);
    expect(googleDocId(`https://docs.google.com/document/u/0/d/${id}`)).toBe(id);
    expect(googleDocId(`http://docs.google.com/document/d/${id}/edit`)).toBeNull();
    expect(googleDocId(`https://docs.google.com.evil.io/document/d/${id}`)).toBeNull();
    expect(googleDocId(`https://docs.google.com/spreadsheets/d/${id}`)).toBeNull();
    expect(googleDocId("not a url")).toBeNull();
  });
});
