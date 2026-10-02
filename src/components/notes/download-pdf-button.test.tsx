import { describe, expect, it } from "vitest";

import { contentDisposition } from "@/lib/http/content-disposition";

import { filenameFromDisposition } from "./download-pdf-button";

describe("filenameFromDisposition", () => {
  it("reads back the UTF-8 name the server's header carries", () => {
    for (const name of ["Weekly sync.pdf", "Q3 (draft) — café's notes.pdf", "会议.pdf"]) {
      expect(filenameFromDisposition(contentDisposition("attachment", name))).toBe(name);
    }
  });

  it("returns null without a filename* parameter or with a broken one", () => {
    expect(filenameFromDisposition(null)).toBeNull();
    expect(filenameFromDisposition('attachment; filename="x.pdf"')).toBeNull();
    expect(filenameFromDisposition("attachment; filename*=UTF-8''%E0%A4")).toBeNull();
  });
});
