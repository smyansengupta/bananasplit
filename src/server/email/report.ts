import type { ComputedWidget } from "@/lib/reports/compute";
import { formatValue } from "@/lib/reports/compute";

import { escapeHtml } from "./escape";
import { EMAIL_COLORS as C, layout, type RenderedEmail } from "./templates";

/**
 * A saved report on its schedule, by email (src/server/reports/
 * schedule-jobs.ts): the insights first, then each headline number with
 * its change, then a link to the whole report. The numbers are the
 * recipient's own (computed as them), so nobody is sent a row they
 * couldn't open.
 */

function row(title: string, detail: string): string {
  return `<tr><td style="padding:10px 0;border-top:1px solid ${C.line}"><p style="margin:0;font-size:15px;font-weight:600">${escapeHtml(title)}</p><p style="margin:2px 0 0;font-size:13px;color:${C.muted}">${escapeHtml(detail)}</p></td></tr>`;
}

export function reportEmail(input: {
  orgName: string;
  title: string;
  sourceName: string;
  rangeLabel: string;
  computed: readonly ComputedWidget[];
  url: string;
}): RenderedEmail {
  const insights = input.computed.find((c) => c.payload?.type === "insights");
  const lines =
    insights?.payload?.type === "insights" ? insights.payload.data.lines.map((l) => l.text) : [];
  const numbers: { title: string; detail: string }[] = [];
  for (const c of input.computed) {
    const p = c.payload;
    if (p?.type === "number") {
      const change =
        p.data.deltaPct === null
          ? ""
          : Math.abs(p.data.deltaPct) < 1
            ? `, about the same as ${p.data.previousLabel ?? "the period before"}`
            : `, ${p.data.deltaPct > 0 ? "up" : "down"} ${Math.abs(Math.round(p.data.deltaPct))}% on ${p.data.previousLabel ?? "the period before"}`;
      numbers.push({
        title: `${c.title}: ${formatValue(p.data.value, p.data.format)}`,
        detail: `${input.rangeLabel}${change}`,
      });
    } else if (p?.type === "overdue" && (p.data.overdueCount > 0 || p.data.staleCount > 0)) {
      numbers.push({
        title: `${c.title}: ${p.data.overdueCount} past due`,
        detail: `${p.data.staleCount} untouched for ${p.data.staleDays} days or more`,
      });
    } else if (p?.type === "goal" && p.data.target) {
      numbers.push({
        title: `${c.title}: ${p.data.pct}%`,
        detail: `${formatValue(p.data.value, p.data.format)} of ${formatValue(p.data.target, p.data.format)}`,
      });
    }
  }
  const sub = `${input.sourceName}, ${input.rangeLabel.replace(/^(This|Last|All) /, (w) => w.toLowerCase())}`;
  const bodyHtml =
    `<p style="margin:0 0 4px;font-size:22px;font-weight:700;line-height:1.25;color:${C.ink}">${escapeHtml(input.title)}</p>` +
    `<p style="margin:0 0 18px;font-size:14px;color:${C.muted}">${escapeHtml(sub)}</p>` +
    lines
      .map((t) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.55">${escapeHtml(t)}</p>`)
      .join("") +
    (numbers.length
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px">${numbers
          .map((n) => row(n.title, n.detail))
          .join("")}</table>`
      : "");
  const bodyText = [
    input.title,
    sub,
    ...lines,
    ...numbers.map((n) => `${n.title}\n${n.detail}`),
  ].join("\n\n");
  return layout({
    subject: `${input.title}: ${input.rangeLabel}`,
    eyebrow: input.orgName,
    bodyHtml,
    bodyText,
    cta: { label: "Open the report", url: input.url },
    footer: "Turn off scheduled report emails on your profile, under Notifications.",
  });
}
