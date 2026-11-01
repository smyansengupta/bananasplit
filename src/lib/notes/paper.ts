/**
 * Document mode's paper (Note.paperSize), shared by the editor's page view
 * and the PDF export so what prints is what you see: the same sheet, the
 * same one-inch margins, the same header and footer bands.
 *
 * CSS pixels are 1/96 inch and PDF points 1/72 inch.
 */

export type PaperSizeName = "LETTER" | "A4";

export interface Paper {
  label: string;
  /** react-pdf's page size name. */
  pdfSize: "LETTER" | "A4";
  widthIn: number;
  heightIn: number;
}

export const PAPERS: Record<PaperSizeName, Paper> = {
  LETTER: { label: "Letter", pdfSize: "LETTER", widthIn: 8.5, heightIn: 11 },
  A4: { label: "A4", pdfSize: "A4", widthIn: 210 / 25.4, heightIn: 297 / 25.4 },
};

/** Margins on every side, in inches. */
export const MARGIN_IN = 1;
/** The header and footer sit inside the top and bottom margins, this far from the edge. */
export const BAND_IN = 0.45;

export const PX_PER_IN = 96;
export const PT_PER_IN = 72;

export function paperOf(size: string | null | undefined): Paper {
  return PAPERS[size === "A4" ? "A4" : "LETTER"];
}

/** The sheet and its writable area in CSS pixels. */
export function paperPx(size: string | null | undefined) {
  const paper = paperOf(size);
  const width = Math.round(paper.widthIn * PX_PER_IN);
  const height = Math.round(paper.heightIn * PX_PER_IN);
  const margin = MARGIN_IN * PX_PER_IN;
  return { width, height, margin, contentHeight: height - 2 * margin };
}

/** The same in PDF points. */
export function paperPt(size: string | null | undefined) {
  const paper = paperOf(size);
  return {
    width: paper.widthIn * PT_PER_IN,
    height: paper.heightIn * PT_PER_IN,
    margin: MARGIN_IN * PT_PER_IN,
    band: BAND_IN * PT_PER_IN,
  };
}

/** Note.headerText and Note.footerText: at most this many characters (a check constraint). */
export const MAX_BAND_TEXT = 200;

/** The header band: the note's own text, else its title and club. */
export function bandHeader(note: { title: string; orgName: string; headerText?: string | null }) {
  const own = note.headerText?.trim();
  if (own) return own;
  return [note.title.trim() || "Untitled note", note.orgName].filter(Boolean).join(", ");
}

/** The footer band's text beside the page number: the note's own, else its title. */
export function bandFooter(note: { title: string; footerText?: string | null }) {
  return note.footerText?.trim() || note.title.trim() || "Untitled note";
}
