// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildPdf } from "@/lib/org-chart/__fixtures__/generate";
import { buildDocx, buildZip } from "@/lib/org-chart/__fixtures__/zip-writer";

import {
  countPdfPages,
  extractSource,
  MAX_PDF_PAGES,
  preflightSource,
  sniffSource,
  SourceRejectedError,
} from "./extract";

const dir = path.resolve("src/lib/org-chart/__fixtures__");
const fixture = (name: string) => readFileSync(path.join(dir, name));

async function extract(name: string) {
  const bytes = fixture(name);
  return extractSource(bytes, sniffSource(bytes, name));
}

function rejected(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof SourceRejectedError) return error.message;
    throw error;
  }
  throw new Error("expected a SourceRejectedError");
}

describe("sniffSource", () => {
  it("recognizes the fixtures by their bytes", () => {
    expect(sniffSource(fixture("cbc-fall-2026.pdf"), "x.bin").kind).toBe("pdf");
    expect(sniffSource(fixture("cbc-fall-2026.docx"), "x.bin").kind).toBe("docx");
    expect(sniffSource(fixture("cbc-fall-2026.md"), "chart.md").kind).toBe("markdown");
    expect(sniffSource(fixture("cbc-fall-2026.txt"), "chart.txt").kind).toBe("text");
    // The name only chooses Markdown vs text; it never makes a binary acceptable.
    expect(sniffSource(fixture("cbc-fall-2026.md"), "chart.pdf").kind).toBe("text");
  });

  it("refuses .docm, ODT, RTF, old .doc, other ZIPs and binaries", () => {
    const docm = buildDocx(["Hi"], { macroEnabled: true });
    expect(rejected(() => sniffSource(docm, "a.docm"))).toMatch(/Macro-enabled/);
    const odt = buildZip([
      {
        name: "mimetype",
        data: Buffer.from("application/vnd.oasis.opendocument.text"),
        store: true,
      },
      { name: "content.xml", data: Buffer.from("<x/>") },
    ]);
    expect(rejected(() => sniffSource(odt, "a.odt"))).toMatch(/OpenDocument/);
    expect(rejected(() => sniffSource(Buffer.from("{\\rtf1\\ansi hi}"), "a.rtf"))).toMatch(/RTF/);
    expect(
      rejected(() => sniffSource(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2]), "a.doc")),
    ).toMatch(/\.doc/);
    const zip = buildZip([{ name: "photo.jpg", data: Buffer.from("x") }]);
    expect(rejected(() => sniffSource(zip, "a.zip"))).toMatch(/isn't a Word document/);
    expect(
      rejected(() => sniffSource(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0xff]), "a.png")),
    ).toMatch(/isn't supported/);
    expect(rejected(() => sniffSource(Buffer.alloc(0), "a.txt"))).toMatch(/empty/);
  });
});

describe("DOCX zip-bomb guards", () => {
  it("refuses a part that expands far beyond its compressed size", () => {
    const bomb = buildZip([
      { name: "[Content_Types].xml", data: Buffer.from("<Types/>") },
      { name: "word/document.xml", data: Buffer.alloc(5 * 1024 * 1024, 0x41) },
    ]);
    expect(bomb.length).toBeLessThan(100 * 1024);
    expect(rejected(() => sniffSource(bomb, "bomb.docx"))).toMatch(/suspicious compression/);
  });

  it("refuses a part whose header under-reports its size", () => {
    const liar = buildZip([
      { name: "[Content_Types].xml", data: Buffer.from("<Types/>") },
      { name: "word/document.xml", data: Buffer.alloc(200_000, 0x41), declaredSize: 1000 },
    ]);
    expect(rejected(() => sniffSource(liar, "liar.docx"))).toMatch(/declared size|suspicious/);
  });

  it("refuses too many parts and a total over 20 MB", () => {
    const many = buildZip(
      Array.from({ length: 501 }, (_, i) => ({
        name: `p${i}.xml`,
        data: Buffer.from("x"),
        store: true,
      })),
    );
    expect(rejected(() => sniffSource(many, "many.docx"))).toMatch(/too many parts/);
    const big = buildZip([
      { name: "[Content_Types].xml", data: Buffer.from("<Types/>") },
      { name: "word/document.xml", data: Buffer.alloc(1000, 0x41), declaredSize: 21 * 1024 * 1024 },
    ]);
    expect(rejected(() => sniffSource(big, "big.docx"))).toMatch(/too large|20 MB|suspicious/);
  });
});

describe("extractSource", () => {
  it("reads the Markdown and text fixtures as normalized text", async () => {
    const md = await extract("cbc-fall-2026.md");
    expect(md.type).toBe("text");
    if (md.type !== "text") return;
    expect(md.text).toContain("### VP Growth: Lucas Salzgeber");
    expect(md.text).toContain("Graphic Designer: Open Hire");
    const txt = await extract("cbc-fall-2026.txt");
    if (txt.type !== "text") throw new Error("expected text");
    expect(txt.text).toContain("VP Growth: Lucas Salzgeber");
    expect(txt.text).not.toContain("###");
  });

  it("reads the DOCX fixture through mammoth", async () => {
    const docx = await extract("cbc-fall-2026.docx");
    if (docx.type !== "text") throw new Error("expected text");
    expect(docx.format).toBe("docx");
    expect(docx.text).toContain("President: Jackson Lamoureux");
    expect(docx.text).toContain("Head of Social & Membership: Kristine Min");
  });

  it("passes the PDF fixture through as a document block with its page count", async () => {
    const pdf = await extract("cbc-fall-2026.pdf");
    if (pdf.type !== "pdf") throw new Error("expected pdf");
    expect(pdf.pages).toBe(2);
    expect(Buffer.from(pdf.base64, "base64").subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("strips control characters and refuses empty or oversized text", async () => {
    const dirty = Buffer.from("President\u0007: Jackson\r\n\r\n\r\n\r\n\r\nVP: Oliver");
    const out = await extractSource(dirty, sniffSource(dirty, "a.txt"));
    if (out.type !== "text") throw new Error("expected text");
    expect(out.text).toBe("President: Jackson\n\n\nVP: Oliver");
    const blank = Buffer.from("   \n\n  ");
    await expect(extractSource(blank, sniffSource(blank, "a.txt"))).rejects.toThrow(/no text/);
    const huge = Buffer.from("a".repeat(200_001));
    expect(rejected(() => preflightSource(huge, sniffSource(huge, "a.txt")))).toMatch(/too long/);
  });

  it(`refuses a PDF over ${MAX_PDF_PAGES} pages and an encrypted PDF`, () => {
    const long = buildPdf(Array.from({ length: 60 * 21 }, (_, i) => `line ${i}`));
    expect(countPdfPages(long)).toBe(21);
    expect(rejected(() => preflightSource(long, sniffSource(long, "a.pdf")))).toMatch(/20 pages/);
    const encrypted = Buffer.concat([
      buildPdf(["x"]),
      Buffer.from("trailer << /Encrypt 9 0 R >>\n%%EOF"),
    ]);
    expect(rejected(() => preflightSource(encrypted, sniffSource(encrypted, "a.pdf")))).toMatch(
      /Password/,
    );
  });
});

describe("countPdfPages", () => {
  // The old `/Count n[^>]*?/Type /Pages` alternation re-scanned to the end of
  // the buffer for every /Count, so this input took ~22.5 s at 1 MB and
  // minutes at the 4 MB upload cap, with nothing able to interrupt it.
  it("scans a 1 MB buffer of /Count markers in well under 250 ms", () => {
    const hostile = Buffer.from(
      `%PDF-1.4\n${"/Count 1 ".repeat(Math.ceil((1024 * 1024) / 9))}`,
      "latin1",
    );
    expect(hostile.length).toBeGreaterThan(1024 * 1024);
    const started = performance.now();
    const pages = countPdfPages(hostile);
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(250);
    // No /Type /Pages and no /Type /Page anywhere, so there is nothing to count.
    expect(pages).toBeNull();
  });

  it("still reads the page tree, in either order and past a long /Kids array", () => {
    expect(countPdfPages(Buffer.from("%PDF-1.4\n<< /Type /Pages /Kids [3 0 R] /Count 7 >>"))).toBe(
      7,
    );
    expect(countPdfPages(Buffer.from("%PDF-1.4\n<< /Count 9 /Kids [3 0 R] /Type /Pages >>"))).toBe(
      9,
    );
    const kids = Array.from({ length: 400 }, (_, i) => `${i + 4} 0 R`).join(" ");
    expect(
      countPdfPages(Buffer.from(`%PDF-1.4\n<< /Type /Pages /Kids [${kids}] /Count 400 >>`)),
    ).toBe(400);
    // A /Count in another dictionary does not belong to the page tree.
    expect(
      countPdfPages(Buffer.from("%PDF-1.4\n<< /Count 900 >>\n<< /Type /Pages /Count 3 >>")),
    ).toBe(3);
    // /Pages is never counted as a /Page object.
    expect(countPdfPages(Buffer.from("%PDF-1.4\n<< /Type /Pages >>"))).toBeNull();
    expect(countPdfPages(Buffer.from("%PDF-1.4\n<< /Type /Page >>\n<< /Type /Page >>"))).toBe(2);
  });

  it("counts the real fixture and the generated multi-page PDF", () => {
    expect(countPdfPages(fixture("cbc-fall-2026.pdf"))).toBe(2);
    expect(countPdfPages(buildPdf(Array.from({ length: 60 * 5 }, (_, i) => `line ${i}`)))).toBe(5);
    expect(countPdfPages(Buffer.from("%PDF-1.4\nnothing here"))).toBeNull();
  });
});
