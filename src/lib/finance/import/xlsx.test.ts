import { strToU8, zipSync, type Zippable } from "fflate";
import { describe, expect, it } from "vitest";

import { isZip, readXlsx, SpreadsheetError, type SheetData } from "./xlsx";

// ---- Building real .xlsx files ------------------------------------------

const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

interface TestSheet {
  name: string;
  /** <row> elements, wrapped in a plain worksheet. */
  rows?: string;
  /** The whole worksheet part, instead of `rows`. */
  xml?: string;
  state?: "visible" | "hidden" | "veryHidden";
  /** The relationship target. Default: worksheets/sheetN.xml, N counting from 1. */
  target?: string;
  /** The relationship type. Default: worksheet. */
  type?: string;
  /** Where the part is stored in the zip (default: the target, resolved); null leaves it out. */
  path?: string | null;
}

interface TestWorkbook {
  sheets: TestSheet[];
  /** <si> elements, as raw XML. */
  strings?: string[];
  /** The whole styles part. */
  styles?: string;
  date1904?: boolean;
  /** More zip entries, or replacements for the generated ones. */
  files?: Record<string, string | Uint8Array>;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function targetOf(sheet: TestSheet, index: number): string {
  return sheet.target ?? `worksheets/sheet${index + 1}.xml`;
}

function buildXlsx(book: TestWorkbook): Uint8Array {
  const sheetTags = book.sheets
    .map((sheet, i) => {
      const state = sheet.state ? ` state="${sheet.state}"` : "";
      return `<sheet name="${escapeXml(sheet.name)}" sheetId="${i + 1}"${state} r:id="rId${i + 1}"/>`;
    })
    .join("");
  // Listed back to front: a relationship is found by its Id, not its position.
  const relationships = book.sheets
    .map((sheet, i) => {
      const type = sheet.type ?? `${REL_NS}/worksheet`;
      return `<Relationship Id="rId${i + 1}" Type="${type}" Target="${targetOf(sheet, i)}"/>`;
    })
    .reverse()
    .join("");
  const n = book.sheets.length;
  const files: Record<string, string | Uint8Array> = {
    "[Content_Types].xml": `${XML_DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`,
    "_rels/.rels": `${XML_DECLARATION}<Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `${XML_DECLARATION}<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><workbookPr${book.date1904 ? ' date1904="1"' : ""} defaultThemeVersion="164011"/><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="12300"/></bookViews><sheets>${sheetTags}</sheets><calcPr calcId="191029"/></workbook>`,
    "xl/_rels/workbook.xml.rels": `${XML_DECLARATION}<Relationships xmlns="${PACKAGE_REL_NS}">${relationships}<Relationship Id="rId${n + 1}" Type="${REL_NS}/styles" Target="styles.xml"/><Relationship Id="rId${n + 2}" Type="${REL_NS}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
  };
  book.sheets.forEach((sheet, i) => {
    const target = targetOf(sheet, i);
    const path =
      sheet.path === undefined
        ? target.startsWith("/")
          ? target.slice(1)
          : `xl/${target}`
        : sheet.path;
    if (path !== null) files[path] = sheet.xml ?? worksheetXml(sheet.rows ?? "");
  });
  if (book.strings) {
    const count = book.strings.length;
    files["xl/sharedStrings.xml"] =
      `${XML_DECLARATION}<sst xmlns="${MAIN_NS}" count="${count}" uniqueCount="${count}">${book.strings.join("")}</sst>`;
  }
  if (book.styles) files["xl/styles.xml"] = book.styles;
  Object.assign(files, book.files);

  const zippable: Zippable = {};
  for (const [name, content] of Object.entries(files)) {
    zippable[name] = typeof content === "string" ? strToU8(content) : content;
  }
  return zipSync(zippable);
}

function worksheetXml(rows: string): string {
  return `${XML_DECLARATION}<worksheet xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><dimension ref="A1"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="1" width="12" customWidth="1"/></cols><sheetData>${rows}</sheetData><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`;
}

/**
 * A styles part whose <cellXfs> use these numFmtIds in order (so a cell's s
 * is an index into `numFmtIds`), plus custom format codes by id. The named
 * style in <cellStyleXfs> and the conditional format in <dxfs> carry date
 * formats that must not leak into cells.
 */
function stylesXml(numFmtIds: number[], customFormats: Record<number, string> = {}): string {
  const custom = Object.entries(customFormats)
    .map(([id, code]) => `<numFmt numFmtId="${id}" formatCode="${escapeXml(code)}"/>`)
    .join("");
  const numFmts = custom
    ? `<numFmts count="${Object.keys(customFormats).length}">${custom}</numFmts>`
    : "";
  const xfs = numFmtIds
    .map(
      (id) =>
        `<xf numFmtId="${id}" fontId="0" fillId="0" borderId="0" xfId="0"${id ? ' applyNumberFormat="1"' : ""}/>`,
    )
    .join("");
  return `${XML_DECLARATION}<styleSheet xmlns="${MAIN_NS}">${numFmts}<fonts count="1"><font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="14" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${numFmtIds.length}">${xfs}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="1"><dxf><numFmt numFmtId="300" formatCode="yyyy-mm-dd"/></dxf></dxfs><tableStyles count="0"/></styleSheet>`;
}

const row = (r: number, cells: string) => `<row r="${r}" spans="1:4">${cells}</row>`;
/** A number cell, styled with cellXfs index `s` when given. */
const numberCell = (ref: string, value: number | string, s?: number) =>
  `<c r="${ref}"${s === undefined ? "" : ` s="${s}"`}><v>${value}</v></c>`;
const sharedCell = (ref: string, index: number) => `<c r="${ref}" t="s"><v>${index}</v></c>`;
const inlineCell = (ref: string, text: string) =>
  `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;

/** The only sheet of a workbook holding `rows`. */
function readOne(
  rows: string,
  book: Omit<TestWorkbook, "sheets"> = {},
  opts?: Parameters<typeof readXlsx>[1],
): SheetData {
  const sheets = readXlsx(buildXlsx({ ...book, sheets: [{ name: "Sheet1", rows }] }), opts);
  expect(sheets).toHaveLength(1);
  return sheets[0];
}

/** Each [s, value] as a number cell in its own row; the cell texts, top to bottom. */
function formatted(
  cells: Array<[s: number, value: number | string]>,
  book: Omit<TestWorkbook, "sheets">,
): string[] {
  const rows = cells.map(([s, value], i) => row(i + 1, numberCell(`A${i + 1}`, value, s))).join("");
  return readOne(rows, book).rows.map((cellsOfRow) => cellsOfRow[0]);
}

function spreadsheetErrorFrom(read: () => unknown): SpreadsheetError {
  try {
    read();
  } catch (error) {
    expect(error).toBeInstanceOf(SpreadsheetError);
    return error as SpreadsheetError;
  }
  throw new Error("Expected a SpreadsheetError, but nothing was thrown.");
}

// ---- Tests ----------------------------------------------------------------

describe("readXlsx — a workbook as Excel writes it", () => {
  it("reads headers, dates, text, amounts and formula results", () => {
    const workbook = `${XML_DECLARATION}<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x15 xr xr6 xr10 xr2" xmlns:x15="http://schemas.microsoft.com/office/spreadsheetml/2010/11/main" xmlns:xr="http://schemas.microsoft.com/office/spreadsheetml/2014/revision" xmlns:xr6="http://schemas.microsoft.com/office/spreadsheetml/2016/revision6" xmlns:xr10="http://schemas.microsoft.com/office/spreadsheetml/2016/revision10" xmlns:xr2="http://schemas.microsoft.com/office/spreadsheetml/2015/revision2"><fileVersion appName="xl" lastEdited="7" lowestEdited="7" rupBuild="27425"/><workbookPr defaultThemeVersion="202300"/><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="x15"><x15ac:absPath url="C:\\Users\\treasurer\\Documents\\" xmlns:x15ac="http://schemas.microsoft.com/office/spreadsheetml/2010/11/ac"/></mc:Choice></mc:AlternateContent><xr:revisionPtr revIDLastSave="0" documentId="8_{6F0A1E2B-0000-0000-0000-000000000000}" xr6:coauthVersionLast="47" xr6:coauthVersionMax="47" xr10:uidLastSave="{00000000-0000-0000-0000-000000000000}"/><bookViews><workbookView xWindow="-110" yWindow="-110" windowWidth="25820" windowHeight="15500" xr2:uid="{00000000-000D-0000-FFFF-FFFF00000000}"/></bookViews><sheets><sheet name="Transactions" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="191029"/><extLst><ext uri="{140A7094-0E35-4892-8432-C4D2E57EDEB5}" xmlns:x15="http://schemas.microsoft.com/office/spreadsheetml/2010/11/main"><x15:workbookPr chartTrackingRefBase="1"/></ext></extLst></workbook>`;
    const sheet = `${XML_DECLARATION}<worksheet xmlns="${MAIN_NS}" xmlns:r="${REL_NS}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x14ac xr xr2 xr3" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac" xmlns:xr="http://schemas.microsoft.com/office/spreadsheetml/2014/revision" xmlns:xr2="http://schemas.microsoft.com/office/spreadsheetml/2015/revision2" xmlns:xr3="http://schemas.microsoft.com/office/spreadsheetml/2016/revision3" xr:uid="{00000000-0001-0000-0000-000000000000}"><dimension ref="A1:D3"/><sheetViews><sheetView tabSelected="1" workbookViewId="0"><selection activeCell="D4" sqref="D4"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="14.5" x14ac:dyDescent="0.35"/><cols><col min="1" max="1" width="10.6328125" bestFit="1" customWidth="1"/></cols><sheetData><row r="1" spans="1:4" x14ac:dyDescent="0.35"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row><row r="2" spans="1:4" x14ac:dyDescent="0.35"><c r="A2" s="1"><v>45658</v></c><c r="B2" t="s"><v>4</v></c><c r="C2" s="2"><v>-42.15</v></c><c r="D2" s="2"><f>C2</f><v>-42.15</v></c></row><row r="3" spans="1:4" x14ac:dyDescent="0.35"><c r="A3" s="1"><v>45659</v></c><c r="B3" t="s"><v>5</v></c><c r="C3" s="2"><v>1250</v></c><c r="D3" s="2"><f>D2+C3</f><v>1207.8500000000001</v></c></row></sheetData><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`;
    const styles = `${XML_DECLARATION}<styleSheet xmlns="${MAIN_NS}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x14ac x16r2 xr" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac" xmlns:x16r2="http://schemas.microsoft.com/office/spreadsheetml/2015/02/main" xmlns:xr="http://schemas.microsoft.com/office/spreadsheetml/2014/revision"><numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/></numFmts><fonts count="1" x14ac:knownFonts="1"><font><sz val="11"/><color theme="1"/><name val="Aptos Narrow"/><family val="2"/><scheme val="minor"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/><extLst><ext uri="{EB79DEF2-80B8-43e5-95BD-54CBDDF9020C}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><x14:slicerStyles defaultSlicerStyle="SlicerStyleLight1"/></ext></extLst></styleSheet>`;
    const bytes = buildXlsx({
      sheets: [{ name: "Transactions", xml: sheet }],
      strings: [
        "<si><t>Date</t></si>",
        "<si><t>Description</t></si>",
        "<si><t>Amount</t></si>",
        "<si><t>Balance</t></si>",
        "<si><t>Pizza for the kickoff</t></si>",
        "<si><t>Dues - spring</t></si>",
      ],
      styles,
      files: { "xl/workbook.xml": workbook },
    });

    expect(readXlsx(bytes)).toEqual([
      {
        name: "Transactions",
        rows: [
          ["Date", "Description", "Amount", "Balance"],
          ["2025-01-01", "Pizza for the kickoff", "-42.15", "-42.15"],
          ["2025-01-02", "Dues - spring", "1250", "1207.85"],
        ],
        rowNumbers: [1, 2, 3],
        hidden: false,
        truncated: false,
      },
    ]);
  });
});

describe("readXlsx — text cells", () => {
  it("reads shared strings, rich-text runs, inline strings, formula strings, booleans and errors", () => {
    const strings = [
      "<si><t>Plain</t></si>",
      '<si><r><t xml:space="preserve">Rich </t></r><r><rPr><b/><sz val="11"/><color rgb="FFFF0000"/><rFont val="Calibri"/><family val="2"/></rPr><t>text</t></r></si>',
    ];
    const cells = [
      sharedCell("A1", 0),
      sharedCell("B1", 1),
      '<c r="C1" t="inlineStr"><is><r><t>In</t></r><r><rPr><i/></rPr><t>line</t></r></is></c>',
      '<c r="D1" t="str"><f>CONCATENATE("a","b")</f><v>ab</v></c>',
      '<c r="E1" t="b"><v>1</v></c>',
      '<c r="F1" t="b"><v>0</v></c>',
      '<c r="G1" t="e"><f>1/0</f><v>#DIV/0!</v></c>',
      '<c r="H1" t="str"><v>a &amp; b</v></c>',
    ].join("");

    expect(readOne(row(1, cells), { strings }).rows).toEqual([
      ["Plain", "Rich text", "Inline", "ab", "TRUE", "FALSE", "", "a & b"],
    ]);
  });

  it("leaves out phonetic guides (furigana) from shared strings", () => {
    const strings = [
      '<si><t>東京都</t><rPh sb="0" eb="2"><t>トウキョウ</t></rPh><rPh sb="2" eb="3"><t>ト</t></rPh><phoneticPr fontId="1"/></si>',
      '<si><r><t>山田</t></r><r><t>太郎</t></r><rPh sb="0" eb="2"><t>ヤマダ</t></rPh><phoneticPr fontId="1" type="noConversion"/></si>',
    ];
    expect(readOne(row(1, sharedCell("A1", 0) + sharedCell("B1", 1)), { strings }).rows).toEqual([
      ["東京都", "山田太郎"],
    ]);
  });

  it("reads a missing or out-of-range shared string as empty", () => {
    const rows = row(
      1,
      sharedCell("A1", 5) + '<c r="B1" t="s"><v></v></c>' + inlineCell("C1", "kept"),
    );
    expect(readOne(rows, { strings: ["<si><t>only</t></si>"] }).rows).toEqual([["", "", "kept"]]);
  });

  it('reads t="d" ISO dates as the day, with the time when it isn\'t midnight', () => {
    const cells = [
      '<c r="A1" t="d"><v>2025-09-05T00:00:00Z</v></c>',
      '<c r="B1" t="d"><v>2025-09-05T14:33:00</v></c>',
      '<c r="C1" t="d"><v>2025-09-05</v></c>',
    ].join("");
    expect(readOne(row(1, cells)).rows).toEqual([["2025-09-05", "2025-09-05 14:33", "2025-09-05"]]);
  });
});

describe("readXlsx — numbers", () => {
  it("writes plain decimal text without float noise", () => {
    const values = [
      ["0.30000000000000004", "0.3"],
      ["12.50", "12.5"],
      ["1E-3", "0.001"],
      ["-5", "-5"],
      ["-1234.5", "-1234.5"],
      ["-0.1", "-0.1"],
      ["100", "100"],
      ["2.0000000000000004", "2"],
      ["1207.8500000000001", "1207.85"],
      // Noise within 10 decimals: rounding to Excel's 15 significant digits removes it.
      ["1000000.2999999999", "1000000.3"],
      ["3703701.3000000003", "3703701.3"],
      ["0.1234567890123", "0.123456789"],
      ["1e-7", "0.0000001"],
      ["1E-11", "0"],
      ["123456789012", "123456789012"],
      ["1e21", "1e+21"],
      ["-0", "0"],
      ["n/a", "n/a"],
    ];
    const cells = values.map(([raw], i) => row(i + 1, numberCell(`A${i + 1}`, raw))).join("");
    expect(readOne(cells).rows.map((r) => r[0])).toEqual(values.map(([, text]) => text));
  });

  it("keeps numbers as numbers under number, currency, percent, text and accounting formats", () => {
    const codes = [
      "0.00",
      "#,##0",
      "0%",
      "@",
      "General",
      '"$"#,##0.00',
      "[Red]0.00;[Blue]-0.00",
      "[$-409]#,##0.00",
      '0.0 "days"',
      '#,##0.00\\ "kr"',
      '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)',
      "0.00E+00",
    ];
    const custom = Object.fromEntries(codes.map((code, i) => [164 + i, code]));
    const builtIn = [0, 1, 2, 3, 4, 9, 10, 11, 49];
    // 300 is only defined in <dxfs>, so it isn't a cell format.
    const ids = [...builtIn, ...codes.map((_, i) => 164 + i), 300];
    const cells = ids.map((_, s): [number, number] => [s, 45000.5]);

    expect(formatted(cells, { styles: stylesXml(ids, custom) })).toEqual(ids.map(() => "45000.5"));
  });
});

describe("readXlsx — dates", () => {
  it("shows a built-in date format (numFmtId 14) as YYYY-MM-DD", () => {
    const styles = stylesXml([0, 14]);
    const cells: Array<[number, number]> = [
      [1, 45000],
      [1, 44927],
      [1, 45000.75],
      // A computed date with float noise is still the day it means.
      [1, 44999.99999999999],
      [0, 45000],
    ];
    expect(formatted(cells, { styles })).toEqual([
      "2023-03-15",
      "2023-01-01",
      "2023-03-15",
      "2023-03-15",
      "45000",
    ]);
  });

  it("handles the phantom 1900-02-29 at serials 59, 60 and 61", () => {
    const styles = stylesXml([0, 14]);
    const cells: Array<[number, number]> = [
      [1, 1],
      [1, 59],
      [1, 60],
      [1, 61],
    ];
    expect(formatted(cells, { styles })).toEqual([
      "1900-01-01",
      "1900-02-28",
      "1900-02-28",
      "1900-03-01",
    ]);
  });

  it("recognizes custom date formats, whatever their letters' case or decoration", () => {
    const codes = [
      "mmm d, yyyy",
      "mm/dd/yyyy",
      "DD/MM/YYYY",
      "d-mmm-yy",
      "mmmm",
      "[$-409]dddd, mmmm d, yyyy",
      'yyyy"年"m"月"d"日"',
      "yyyy\\-mm\\-dd;@",
      // A raw ">" inside the attribute value must not end the tag.
      "[>=0]yyyy-mm-dd",
    ];
    const custom = Object.fromEntries(codes.map((code, i) => [164 + i, code]));
    const ids = [0, ...codes.map((_, i) => 164 + i)];
    const cells = codes.map((_, i): [number, number] => [i + 1, 45000.25]);

    expect(formatted(cells, { styles: stylesXml(ids, custom) })).toEqual(
      codes.map(() => "2023-03-15"),
    );
  });

  it("adds the time for a date-time format when there is one", () => {
    const styles = stylesXml([0, 22, 164, 165], {
      164: "yyyy-mm-dd hh:mm:ss",
      165: "m/d/yy h:mm AM/PM",
    });
    const cells: Array<[number, number]> = [
      [1, 45000.75],
      [1, 45000],
      [2, 45000.5208333333],
      [3, 45000.99930556],
      [1, 45000.9999999],
    ];
    expect(formatted(cells, { styles })).toEqual([
      "2023-03-15 18:00",
      "2023-03-15",
      "2023-03-15 12:30",
      "2023-03-15 23:59",
      // 23:59:59.99 rounds to the next midnight.
      "2023-03-16",
    ]);
  });

  it("shows a pure time format as HH:MM and an elapsed-time format in total hours", () => {
    const styles = stylesXml([0, 20, 21, 164, 46, 165], { 164: "h:mm AM/PM", 165: "[h]:mm" });
    const cells: Array<[number, number]> = [
      [1, 0.5625],
      [2, 45000.25],
      [3, 0.75],
      [1, 0.9999999],
      [4, 1.5],
      [5, 2.25],
    ];
    expect(formatted(cells, { styles })).toEqual([
      "13:30",
      "06:00",
      "18:00",
      "00:00",
      "36:00",
      "54:00",
    ]);
  });

  it("counts from 1904-01-01 in the 1904 date system", () => {
    const styles = stylesXml([0, 14, 22]);
    const cells: Array<[number, number]> = [
      [1, 0],
      [1, 43465],
      [2, 43465.5],
      // 9999-12-31 is 1462 days earlier in this system; the day after isn't a date.
      [1, 2957003],
      [1, 2957004],
    ];
    expect(formatted(cells, { styles, date1904: true })).toEqual([
      "1904-01-01",
      "2023-01-01",
      "2023-01-01 12:00",
      "9999-12-31",
      "2957004",
    ]);
  });

  it("leaves negative and out-of-range serials as numbers", () => {
    const styles = stylesXml([0, 14]);
    const cells: Array<[number, number]> = [
      [1, -1],
      [1, 2958465],
      [1, 2958466],
      [1, -0.5],
    ];
    expect(formatted(cells, { styles })).toEqual(["-1", "9999-12-31", "2958466", "-0.5"]);
  });
});

describe("readXlsx — rows and columns", () => {
  it("places cells by reference and fills the gaps with empty text", () => {
    const sheet = readOne(row(2, inlineCell("B2", "x") + inlineCell("D2", "y")));
    expect(sheet.rows).toEqual([["", "x", "", "y"]]);
    expect(sheet.rowNumbers).toEqual([2]);
  });

  it("puts a cell without a reference in the next column, and a row without one on the next row", () => {
    const rows =
      '<row r="3"><c t="inlineStr"><is><t>a</t></is></c><c><v>1</v></c><c r="E3"><v>5</v></c><c><v>6</v></c></row>' +
      "<row><c><v>7</v></c></row>";
    const sheet = readOne(rows);
    expect(sheet.rows).toEqual([["a", "1", "", "", "5", "6"], ["7"]]);
    expect(sheet.rowNumbers).toEqual([3, 4]);
  });

  it("keeps each row's spreadsheet number across gaps and dropped rows", () => {
    const rows = [
      row(1, inlineCell("A1", "Header")),
      '<row r="2"/>',
      '<row r="3" spans="1:3"><c r="A3" s="0"/><c r="B3" s="0"/></row>',
      row(4, inlineCell("A4", "   ")),
      row(5, '<c r="A5" t="e"><v>#N/A</v></c>'),
      row(6, '<c r="A6"><f>SUM(B1:B5)</f></c>'),
      row(9, numberCell("A9", 1)),
      row(12, numberCell("B12", 2)),
    ].join("");
    const sheet = readOne(rows);
    expect(sheet.rows).toEqual([["Header"], ["1"], ["", "2"]]);
    expect(sheet.rowNumbers).toEqual([1, 9, 12]);
  });

  it("trims trailing empty cells but keeps empty cells between values", () => {
    const cells =
      numberCell("A1", 1) +
      '<c r="B1" s="0"/>' +
      numberCell("C1", 3) +
      '<c r="D1" s="0"/>' +
      inlineCell("E1", " ") +
      '<c r="F1" t="s"><v></v></c>';
    expect(readOne(row(1, cells)).rows).toEqual([["1", "", "3"]]);
  });

  it("reads column letters past Z", () => {
    const sheet = readOne(row(1, numberCell("AA1", 27)), {}, { maxCols: 100 });
    expect(sheet.rows[0]).toHaveLength(27);
    expect(sheet.rows[0][26]).toBe("27");
  });
});

describe("readXlsx — sheets", () => {
  it("takes names and order from the workbook, following relative and absolute targets", () => {
    const bytes = buildXlsx({
      sheets: [
        {
          name: "Budget",
          rows: row(1, inlineCell("A1", "budget")),
          target: "worksheets/sheet3.xml",
        },
        {
          name: "P&L 2025",
          rows: row(1, inlineCell("A1", "p and l")),
          target: "/xl/worksheets/sheet1.xml",
        },
        {
          name: "Archive",
          rows: row(1, inlineCell("A1", "archive")),
          target: "worksheets/sheet2.xml",
          state: "hidden",
        },
        {
          name: "Secret",
          rows: row(1, inlineCell("A1", "secret")),
          target: "worksheets/sheet4.xml",
          state: "veryHidden",
        },
        {
          name: "Empty",
          xml: `<worksheet xmlns="${MAIN_NS}"><sheetData/></worksheet>`,
          target: "worksheets/sheet5.xml",
        },
      ],
    });

    expect(
      readXlsx(bytes).map(({ name, rows, hidden, truncated }) => ({
        name,
        first: rows[0]?.[0],
        hidden,
        truncated,
      })),
    ).toEqual([
      { name: "Budget", first: "budget", hidden: false, truncated: false },
      { name: "P&L 2025", first: "p and l", hidden: false, truncated: false },
      { name: "Archive", first: "archive", hidden: true, truncated: false },
      { name: "Secret", first: "secret", hidden: true, truncated: false },
      { name: "Empty", first: undefined, hidden: false, truncated: false },
    ]);
  });

  it("skips chart sheets and sheets whose part is missing", () => {
    const bytes = buildXlsx({
      sheets: [
        {
          name: "Chart1",
          target: "chartsheets/sheet1.xml",
          type: `${REL_NS}/chartsheet`,
          xml: `<chartsheet xmlns="${MAIN_NS}"><sheetViews><sheetView workbookViewId="0"/></sheetViews></chartsheet>`,
        },
        { name: "Gone", rows: row(1, numberCell("A1", 1)), path: null },
        { name: "Data", rows: row(1, numberCell("A1", 2)) },
      ],
    });
    expect(readXlsx(bytes).map((sheet) => [sheet.name, sheet.rows])).toEqual([["Data", [["2"]]]]);
  });

  it("matches part names without regard to case", () => {
    const bytes = buildXlsx({
      sheets: [
        {
          name: "Data",
          rows: row(1, sharedCell("A1", 0)),
          target: "worksheets/Sheet1.XML",
          path: "xl/worksheets/sheet1.xml",
        },
      ],
      strings: ["<si><t>found</t></si>"],
    });
    expect(readXlsx(bytes)[0].rows).toEqual([["found"]]);
  });
});

describe("readXlsx — XML details", () => {
  it("reads tags with a namespace prefix", () => {
    const x = `xmlns:x="${MAIN_NS}"`;
    const bytes = buildXlsx({
      sheets: [
        {
          name: "ignored",
          xml: `<x:worksheet ${x}><x:sheetData><x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="B1" t="s"><x:v>1</x:v></x:c><x:c r="C1" t="inlineStr"><x:is><x:t>inline</x:t></x:is></x:c><x:c r="D1" s="1"><x:v>43465</x:v></x:c><x:c r="E1"/><x:c r="F1"><x:v>2.5</x:v></x:c></x:row><x:row r="2"/><x:row r="3"><x:c r="B3" t="b" xmlns:t="urn:example"><x:v>1</x:v></x:c></x:row></x:sheetData></x:worksheet>`,
        },
      ],
      files: {
        "xl/workbook.xml": `<x:workbook ${x} xmlns:r="${REL_NS}"><x:workbookPr date1904="true"/><x:sheets><x:sheet name="Prefixed" sheetId="1" r:id="rId1"/></x:sheets></x:workbook>`,
        "xl/sharedStrings.xml": `<x:sst ${x}><x:si><x:t>shared</x:t></x:si><x:si><x:r><x:t>ri</x:t></x:r><x:r><x:rPr><x:b/></x:rPr><x:t>ch</x:t></x:r></x:si></x:sst>`,
        "xl/styles.xml": `<x:styleSheet ${x}><x:numFmts count="1"><x:numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></x:numFmts><x:cellXfs count="2"><x:xf numFmtId="0"/><x:xf numFmtId="164"/></x:cellXfs></x:styleSheet>`,
      },
    });

    expect(readXlsx(bytes)).toEqual([
      {
        name: "Prefixed",
        rows: [
          ["shared", "rich", "inline", "2023-01-01", "", "2.5"],
          ["", "TRUE"],
        ],
        rowNumbers: [1, 3],
        hidden: false,
        truncated: false,
      },
    ]);
  });

  it("decodes entities and Office's _xHHHH_ escapes, and normalizes line breaks", () => {
    const strings = [
      "<si><t>Fish &amp; Chips &lt;b&gt; &quot;q&quot; &apos;a&apos; &#65;&#x42; &#x1F600;</t></si>",
      "<si><t>line one_x000D_\nline two</t></si>",
      "<si><t>literal _x005F_x000D_ and tab_x0009_end</t></si>",
      "<si><t>a&#13;&#10;b&#13;c</t></si>",
      "<si><t><![CDATA[a < b & c]]></t></si>",
      "<si><t>Tom &amp; Jerry_x000D_</t></si>",
    ];
    const cells = strings.map((_, i) => sharedCell(`${String.fromCharCode(65 + i)}1`, i)).join("");
    expect(readOne(row(1, cells), { strings }).rows).toEqual([
      [
        "Fish & Chips <b> \"q\" 'a' AB 😀",
        "line one\nline two",
        "literal _x000D_ and tab\tend",
        "a\nb\nc",
        "a < b & c",
        "Tom & Jerry",
      ],
    ]);
  });

  it('keeps spaces marked xml:space="preserve" and trims the rest', () => {
    const strings = [
      '<si><t xml:space="preserve">  padded  </t></si>',
      "<si><t>  trimmed  </t></si>",
    ];
    const cells =
      sharedCell("A1", 0) +
      sharedCell("B1", 1) +
      '<c r="C1" t="inlineStr"><is><t xml:space="preserve"> inline </t></is></c>' +
      '<c r="D1" t="str"><v>  formula  </v></c>';
    expect(readOne(row(1, cells), { strings }).rows).toEqual([
      ["  padded  ", "trimmed", " inline ", "formula"],
    ]);
  });

  it("decodes entities and escapes in sheet names", () => {
    // Excel writes a sheet literally named "_x0041_" as "_x005F_x0041_".
    const bytes = buildXlsx({
      sheets: [{ name: "Q1 & Q2 _x005F_x0041_", rows: row(1, numberCell("A1", 1)) }],
    });
    expect(readXlsx(bytes)[0].name).toBe("Q1 & Q2 _x0041_");
  });

  it("ignores comments", () => {
    const rows = `<!-- <row r="1"><c r="A1"><v>999</v></c></row> -->${row(2, numberCell("A2", 1))}`;
    const sheet = readOne(rows);
    expect(sheet.rows).toEqual([["1"]]);
    expect(sheet.rowNumbers).toEqual([2]);
  });

  it("reads a part saved as UTF-16 with a byte-order mark", () => {
    const xml = `<?xml version="1.0" encoding="UTF-16"?><sst xmlns="${MAIN_NS}"><si><t>naïve café 東京</t></si></sst>`;
    const bytes = buildXlsx({
      sheets: [{ name: "Sheet1", rows: row(1, sharedCell("A1", 0)) }],
      files: { "xl/sharedStrings.xml": Uint8Array.from(Buffer.from(`\ufeff${xml}`, "utf16le")) },
    });
    expect(readXlsx(bytes)[0].rows).toEqual([["naïve café 東京"]]);
  });
});

describe("readXlsx — limits", () => {
  const fiveRows = [1, 2, 3, 4, 5].map((r) => row(r, numberCell(`A${r}`, r))).join("");

  it("stops after maxRows non-empty rows and says it was truncated", () => {
    const sheet = readOne(fiveRows, {}, { maxRows: 3 });
    expect(sheet.rows).toEqual([["1"], ["2"], ["3"]]);
    expect(sheet.rowNumbers).toEqual([1, 2, 3]);
    expect(sheet.truncated).toBe(true);
  });

  it("isn't truncated when the rows fit exactly, even with empty rows after them", () => {
    const rows = fiveRows + '<row r="6"/><row r="7"><c r="A7" s="0"/></row>';
    const sheet = readOne(rows, {}, { maxRows: 5 });
    expect(sheet.rows).toHaveLength(5);
    expect(sheet.truncated).toBe(false);
  });

  it("drops columns at or past maxCols and says it was truncated", () => {
    const sheet = readOne(
      row(1, numberCell("A1", 1) + numberCell("B1", 2) + numberCell("C1", 3)),
      {},
      { maxCols: 2 },
    );
    expect(sheet.rows).toEqual([["1", "2"]]);
    expect(sheet.truncated).toBe(true);
  });

  it("isn't truncated by empty formatted cells past maxCols", () => {
    const sheet = readOne(row(1, numberCell("A1", 1) + '<c r="XFD1" s="0"/>'), {}, { maxCols: 2 });
    expect(sheet.rows).toEqual([["1"]]);
    expect(sheet.truncated).toBe(false);
  });

  it("is truncated when a row's only value lies past maxCols", () => {
    const sheet = readOne(
      row(1, numberCell("A1", 1)) + row(2, numberCell("C2", 3)),
      {},
      { maxCols: 2 },
    );
    expect(sheet.rows).toEqual([["1"]]);
    expect(sheet.truncated).toBe(true);
  });

  it("defaults to 20,000 rows and 60 columns", () => {
    const wide = Array.from({ length: 61 }, (_, i) => `<c><v>${i}</v></c>`).join("");
    const tall = Array.from(
      { length: 20_000 },
      (_, i) => `<row r="${i + 2}"><c r="A${i + 2}"><v>${i}</v></c></row>`,
    );
    const sheet = readOne(`<row r="1">${wide}</row>${tall.join("")}`);
    expect(sheet.rows).toHaveLength(20_000);
    expect(sheet.rows[0]).toHaveLength(60);
    expect(sheet.rowNumbers.at(-1)).toBe(20_000);
    expect(sheet.truncated).toBe(true);
  });

  it("refuses a workbook whose parts would inflate past maxUncompressedBytes", () => {
    const bytes = buildXlsx({ sheets: [{ name: "Big", rows: fiveRows }] });
    const error = spreadsheetErrorFrom(() => readXlsx(bytes, { maxUncompressedBytes: 500 }));
    expect(error.message).toBe("That spreadsheet is too large to open.");
  });

  it("counts only the parts it reads toward that cap", () => {
    // A megabyte of picture is never inflated, so it doesn't count.
    const bytes = buildXlsx({
      sheets: [{ name: "Sheet1", rows: row(1, numberCell("A1", 1)) }],
      files: { "xl/media/image1.png": new Uint8Array(1024 * 1024) },
    });
    expect(readXlsx(bytes, { maxUncompressedBytes: 64 * 1024 })[0].rows).toEqual([["1"]]);
  });
});

describe("readXlsx — files that aren't readable workbooks", () => {
  const csv = strToU8("Date,Amount\n2025-09-05,12.50\n");

  it("refuses a file that isn't a zip", () => {
    for (const bytes of [csv, new Uint8Array(0), strToU8("PK")]) {
      const error = spreadsheetErrorFrom(() => readXlsx(bytes));
      expect(error.message).toBe("That file isn't an Excel workbook (.xlsx).");
      expect(error.name).toBe("SpreadsheetError");
    }
  });

  it("refuses a zip without a workbook, such as a Word document", () => {
    const docx = zipSync({
      "word/document.xml": strToU8("<w:document/>"),
      "[Content_Types].xml": strToU8("<Types/>"),
    });
    expect(spreadsheetErrorFrom(() => readXlsx(docx)).message).toBe(
      "That file isn't an Excel workbook (.xlsx).",
    );
  });

  it("refuses a damaged zip without quoting its contents", () => {
    const whole = buildXlsx({
      sheets: [{ name: "Secret", rows: row(1, inlineCell("A1", "account 12345678")) }],
    });
    const error = spreadsheetErrorFrom(() =>
      readXlsx(whole.subarray(0, Math.floor(whole.length / 2))),
    );
    expect(error.message).toBe("That spreadsheet couldn't be opened. The file may be damaged.");
    expect(error.message).not.toMatch(/12345678|Secret/);
  });
});

describe("isZip", () => {
  it("recognizes the zip signature and nothing else", () => {
    expect(isZip(buildXlsx({ sheets: [{ name: "Sheet1", rows: "" }] }))).toBe(true);
    expect(isZip(strToU8("Date,Amount\n"))).toBe(false);
    expect(isZip(new Uint8Array(0))).toBe(false);
    expect(isZip(strToU8("PK"))).toBe(false);
    // An empty zip is only an end-of-directory record: PK\x05\x06.
    expect(isZip(zipSync({}))).toBe(false);
  });
});
