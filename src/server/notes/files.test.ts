import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildDocx, buildZip } from "@/lib/org-chart/__fixtures__/zip-writer";

vi.mock("@/server/db/context", () => ({ withOrgTx: vi.fn() }));
vi.mock("@/server/storage", () => ({
  MAX_UPLOAD_BYTES: 4 * 1024 * 1024,
  deleteBlobs: vi.fn(),
  getBlob: vi.fn(),
  putBlob: vi.fn(),
  randomKeyId: () => "k",
}));

const { docxToHtml, fetchGoogleDocAsDocx, FileRejectedError, titleFromFilename } = await import("./files");

const fixture = readFileSync(path.resolve("src/lib/org-chart/__fixtures__/cbc-fall-2026.docx"));

describe("Word to note", () => {
  it("turns a .docx into HTML the editor can read", async () => {
    const html = await docxToHtml(fixture);
    expect(html).toMatch(/<p>|<h\d>/);
    expect(await docxToHtml(buildDocx(["Weekly minutes", "Budget approved"]))).toContain("Budget approved");
  });

  it("refuses anything that is not a Word document", async () => {
    await expect(docxToHtml(Buffer.from("%PDF-1.7"))).rejects.toBeInstanceOf(FileRejectedError);
    await expect(docxToHtml(buildZip([{ name: "a.txt", data: Buffer.from("x") }]))).rejects.toBeInstanceOf(
      FileRejectedError,
    );
  });

  it("names the note after the file", () => {
    expect(titleFromFilename("E-board minutes (Oct 3).docx")).toBe("E-board minutes (Oct 3)");
  });
});

describe("Google Docs import", () => {
  afterEach(() => vi.unstubAllGlobals());
  const link = "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit";

  it("follows Google's redirect to the export and reads the title", async () => {
    const docx = buildDocx(["Hello"]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 307,
          headers: { location: "https://doc-0s-9k-docs.googleusercontent.com/export/abc" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array(docx), {
          status: 200,
          headers: { "content-disposition": "attachment; filename*=UTF-8''Kickoff%20plan.docx" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const doc = await fetchGoogleDocAsDocx(link);
    expect(doc.title).toBe("Kickoff plan");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/export?format=docx",
    );
  });

  it("stops at a redirect off Google, and at a sign-in page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://evil.example/x" } })),
    );
    await expect(fetchGoogleDocAsDocx(link)).rejects.toThrow(/Anyone with the link/);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>Sign in</html>", { status: 200 })));
    await expect(fetchGoogleDocAsDocx(link)).rejects.toThrow(/Anyone with the link/);
    await expect(fetchGoogleDocAsDocx("https://example.com/doc")).rejects.toThrow(/Google Docs link/);
  });
});
