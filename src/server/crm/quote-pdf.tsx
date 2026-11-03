import "server-only";

import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import sharp from "sharp";

import { formatMoney } from "@/lib/crm/fields";
import { KIND_WORD, lineCents, quoteTotals, type LineInput, type QuoteKind } from "@/lib/crm/quotes";
import { orgLogoUrl } from "@/lib/org-logo";
import { getBlob } from "@/server/storage";

/**
 * A quote or invoice as a PDF (@react-pdf/renderer), in the organization's
 * own colour and with its logo: the same lines and totals as the page
 * (src/lib/crm/quotes.ts), the PDF standard fonts so nothing is fetched,
 * and the acceptance (who, when) printed once it's accepted.
 */

export interface QuotePdfInput {
  kind: QuoteKind;
  number: string;
  title: string;
  status: string;
  orgName: string;
  /** Organization.logo (its WebP variants); turned into a PNG here. */
  logo: unknown;
  /** The theme's primary colour (hex), for the band and headings. */
  color: string | null;
  forName: string | null;
  currency: string;
  notes: string | null;
  validUntil: Date | null;
  sentAt: Date | null;
  acceptedName: string | null;
  acceptedAt: Date | null;
  lines: LineInput[];
  taxBps: number;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

const day = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Latin-1 only (the standard fonts): anything else becomes "?" instead of garbage. */
function pdfText(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\u0000-ÿ€]/g, "?");
}

/** The logo as PNG bytes (react-pdf reads PNG and JPEG, not WebP), or null. */
async function logoPng(logo: unknown): Promise<Buffer | null> {
  const url = orgLogoUrl(logo, 256);
  if (!url) return null;
  try {
    let bytes: Buffer | null = null;
    const key = /\/(logos\/[A-Za-z0-9_./-]+)$/.exec(url)?.[1];
    if (key) bytes = (await getBlob(key))?.body ?? null;
    if (!bytes && url.startsWith("https://")) {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: "error" });
      if (res.ok) bytes = Buffer.from(await res.arrayBuffer());
    }
    if (!bytes) return null;
    return await sharp(bytes).resize(160, 160, { fit: "inside" }).png().toBuffer();
  } catch {
    return null;
  }
}

function styles(color: string) {
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

function QuoteDocument({ q, logo }: { q: QuotePdfInput; logo: Buffer | null }) {
  const color = q.color && HEX.test(q.color) ? q.color : "#1f3f87";
  const s = styles(color);
  const word = KIND_WORD[q.kind];
  const totals = quoteTotals(q.lines, q.taxBps);
  const money = (c: number) => pdfText(formatMoney(c, q.currency));
  return (
    <Document title={`${word.title} ${q.number}`} author={pdfText(q.orgName)} creator="Bananasplit">
      <Page size="LETTER" style={s.page}>
        <View style={s.band} fixed />
        <View style={s.head}>
          <View style={s.org}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's Image takes no alt */}
            {logo && <Image style={s.logo} src={{ data: logo, format: "png" }} />}
            <Text style={s.orgName}>{pdfText(q.orgName)}</Text>
          </View>
          <View>
            <Text style={s.kind}>{word.title}</Text>
            <Text style={s.number}>{q.number}</Text>
          </View>
        </View>
        <View style={s.facts}>
          {q.forName && (
            <View>
              <Text style={s.factLabel}>For</Text>
              <Text style={s.factValue}>{pdfText(q.forName)}</Text>
            </View>
          )}
          {q.sentAt && (
            <View>
              <Text style={s.factLabel}>Date</Text>
              <Text style={s.factValue}>{day(q.sentAt)}</Text>
            </View>
          )}
          {q.validUntil && (
            <View>
              <Text style={s.factLabel}>{q.kind === "invoice" ? "Due" : "Valid until"}</Text>
              <Text style={s.factValue}>{day(q.validUntil)}</Text>
            </View>
          )}
        </View>
        <Text style={s.title}>{pdfText(q.title)}</Text>
        <View style={s.tableHead}>
          <Text style={[s.th, s.desc]}>Description</Text>
          <Text style={[s.th, s.qty]}>Qty</Text>
          <Text style={[s.th, s.unit]}>Price</Text>
          <Text style={[s.th, s.amount]}>Amount</Text>
        </View>
        {q.lines.map((l, i) => (
          <View key={i} style={s.row} wrap={false}>
            <Text style={s.desc}>{pdfText(l.description)}</Text>
            <Text style={s.qty}>{l.quantity}</Text>
            <Text style={s.unit}>{money(l.unitCents)}</Text>
            <Text style={s.amount}>{money(lineCents(l))}</Text>
          </View>
        ))}
        <View style={s.totals} wrap={false}>
          {q.taxBps > 0 && (
            <>
              <View style={s.totalRow}>
                <Text>Subtotal</Text>
                <Text>{money(totals.subtotalCents)}</Text>
              </View>
              <View style={s.totalRow}>
                <Text>Tax ({(q.taxBps / 100).toFixed(2).replace(/\.?0+$/, "")}%)</Text>
                <Text>{money(totals.taxCents)}</Text>
              </View>
            </>
          )}
          <View style={s.grand}>
            <Text style={s.grandText}>Total</Text>
            <Text style={s.grandText}>{money(totals.totalCents)}</Text>
          </View>
        </View>
        {q.notes && (
          <View wrap={false}>
            <Text style={s.notesTitle}>Notes</Text>
            <Text style={s.notes}>{pdfText(q.notes)}</Text>
          </View>
        )}
        {q.acceptedName && q.acceptedAt && (
          <View style={s.accepted} wrap={false}>
            <Text>
              Accepted by {pdfText(q.acceptedName)} on {day(q.acceptedAt)}, by typing their name.
            </Text>
          </View>
        )}
        <View style={s.footer} fixed>
          <Text>
            {pdfText(q.orgName)} {word.one} {q.number}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderQuotePdf(q: QuotePdfInput): Promise<Buffer> {
  const logo = await logoPng(q.logo);
  return renderToBuffer(<QuoteDocument q={q} logo={logo} />);
}
