/**
 * Regenerates the parser fixtures from cbc-fall-2026.md (the spec's seed
 * section, verbatim):
 *
 *   cbc-fall-2026.txt    plain text (markdown markers removed)
 *   cbc-fall-2026.docx   one paragraph per line
 *   cbc-fall-2026.pdf    Helvetica text, several pages
 *   expected.json        normalizeOrgChart(cbc-fall-2026.raw.json)
 *
 *   pnpm exec tsx src/lib/org-chart/__fixtures__/generate.ts
 *
 * expected.json is checked against the seed template (CBC_POSITIONS) by
 * fixtures.test.ts, so regenerating it cannot silently drift.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { normalizeOrgChart } from "../normalize";
import { OrgChartParseSchema } from "../schema";

import { buildDocx } from "./zip-writer";

const here = path.resolve("src/lib/org-chart/__fixtures__");
const md = readFileSync(path.join(here, "cbc-fall-2026.md"), "utf8");

export function markdownToText(source: string): string {
  return source
    .split("\n")
    .filter((line) => !line.startsWith("```"))
    .map((line) => line.replace(/^#{1,6}\s+/, ""))
    .join("\n");
}

function toWinAnsi(text: string): Buffer {
  const bytes: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 63;
    bytes.push(code < 256 ? code : 63);
  }
  return Buffer.from(bytes);
}

function pdfString(line: string): Buffer {
  const escaped = toWinAnsi(line)
    .toString("latin1")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
  return Buffer.from(`(${escaped})`, "latin1");
}

/** A small valid PDF: Helvetica 10pt, 60 lines per page, with an xref table. */
export function buildPdf(lines: readonly string[]): Buffer {
  const perPage = 60;
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += perPage) pages.push(lines.slice(i, i + perPage));
  if (pages.length === 0) pages.push([]);

  const objects: Buffer[] = [];
  const add = (body: Buffer | string) => {
    objects.push(typeof body === "string" ? Buffer.from(body, "latin1") : body);
    return objects.length;
  };
  const catalog = add(""); // placeholder, filled below
  const pagesObj = add("");
  const font = add(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  );
  const pageIds: number[] = [];
  for (const pageLines of pages) {
    const parts: Buffer[] = [Buffer.from("BT /F1 10 Tf 12 TL 50 800 Td\n", "latin1")];
    for (const line of pageLines) {
      parts.push(pdfString(line), Buffer.from(" Tj T*\n", "latin1"));
    }
    parts.push(Buffer.from("ET\n", "latin1"));
    const stream = Buffer.concat(parts);
    const content = add(
      Buffer.concat([
        Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, "latin1"),
        stream,
        Buffer.from("endstream", "latin1"),
      ]),
    );
    pageIds.push(
      add(
        `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`,
      ),
    );
  }
  objects[catalog - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`, "latin1");
  objects[pagesObj - 1] = Buffer.from(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`,
    "latin1",
  );

  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
  const offsets: number[] = [];
  let length = chunks[0].length;
  objects.forEach((body, i) => {
    offsets.push(length);
    const obj = Buffer.concat([
      Buffer.from(`${i + 1} 0 obj\n`, "latin1"),
      body,
      Buffer.from("\nendobj\n", "latin1"),
    ]);
    chunks.push(obj);
    length += obj.length;
  });
  const xref = [
    "xref",
    `0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n `),
    "trailer",
    `<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>`,
    "startxref",
    String(length),
    "%%EOF",
    "",
  ].join("\n");
  chunks.push(Buffer.from(xref, "latin1"));
  return Buffer.concat(chunks);
}

function main() {
  const text = markdownToText(md);
  writeFileSync(path.join(here, "cbc-fall-2026.txt"), text);
  const lines = text.split("\n");
  writeFileSync(path.join(here, "cbc-fall-2026.docx"), buildDocx(lines));
  writeFileSync(path.join(here, "cbc-fall-2026.pdf"), buildPdf(lines));

  const raw = OrgChartParseSchema.parse(
    JSON.parse(readFileSync(path.join(here, "cbc-fall-2026.raw.json"), "utf8")),
  );
  writeFileSync(
    path.join(here, "expected.json"),
    `${JSON.stringify(normalizeOrgChart(raw), null, 2)}\n`,
  );
  console.log("fixtures written to", here);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]).endsWith(path.join("__fixtures__", "generate.ts"))
) {
  main();
}
