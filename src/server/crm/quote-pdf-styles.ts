import { StyleSheet } from "@react-pdf/renderer";

/**
 * The quote PDF's styles (src/server/crm/quote-pdf.tsx). react-pdf styles
 * are not CSS, so theme variables don't reach them: the organization's own
 * primary colour comes in as a hex value, and the greys are fixed for print.
 */

export const DEFAULT_PDF_COLOR = "#1f3f87";

export function quotePdfStyles(color: string) {
  return StyleSheet.create({
    page: { paddingTop: 48, paddingBottom: 56, paddingHorizontal: 54, fontFamily: "Helvetica", fontSize: 10.5, color: "#1f2328" },
    band: { position: "absolute", top: 0, left: 0, right: 0, height: 8, backgroundColor: color },
    head: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28 },
    org: { flexDirection: "row", alignItems: "center", gap: 10 },
    logo: { width: 40, height: 40, objectFit: "contain" },
    orgName: { fontSize: 14, fontFamily: "Helvetica-Bold" },
    kind: { fontSize: 22, fontFamily: "Helvetica-Bold", color, textAlign: "right" },
    number: { fontSize: 10.5, color: "#57606a", textAlign: "right", marginTop: 2 },
    facts: { flexDirection: "row", gap: 28, marginBottom: 22 },
    factLabel: { fontSize: 8.5, color: "#57606a", marginBottom: 2 },
    factValue: { fontSize: 10.5 },
    title: { fontSize: 15, fontFamily: "Helvetica-Bold", marginBottom: 14 },
    tableHead: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: color, paddingBottom: 5, marginBottom: 4 },
    row: { flexDirection: "row", paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: "#d0d7de" },
    th: { fontSize: 8.5, color: "#57606a", fontFamily: "Helvetica-Bold" },
    desc: { flex: 1, paddingRight: 10 },
    qty: { width: 46, textAlign: "right" },
    unit: { width: 84, textAlign: "right" },
    amount: { width: 90, textAlign: "right" },
    totals: { marginTop: 12, marginLeft: "auto", width: 220 },
    totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
    grand: { flexDirection: "row", justifyContent: "space-between", paddingTop: 7, marginTop: 4, borderTopWidth: 1, borderTopColor: color },
    grandText: { fontSize: 13, fontFamily: "Helvetica-Bold" },
    notesTitle: { fontSize: 8.5, color: "#57606a", fontFamily: "Helvetica-Bold", marginTop: 26, marginBottom: 4 },
    notes: { lineHeight: 1.45 },
    accepted: { marginTop: 26, padding: 10, borderWidth: 1, borderColor: color, borderRadius: 6 },
    footer: { position: "absolute", bottom: 26, left: 54, right: 54, fontSize: 8, color: "#8c959f", flexDirection: "row", justifyContent: "space-between" },
  });
}
