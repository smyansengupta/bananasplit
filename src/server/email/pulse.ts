import { formatCents } from "@/lib/finance/money";
import {
  pulseHeadline,
  pulseRows,
  pulseTitle,
  type PulseFinance,
  type PulseIssueData,
} from "@/lib/pulse/data";

import { escapeHtml } from "./escape";
import { EMAIL_COLORS, layout, type RenderedEmail } from "./templates";

/**
 * The weekly pulse email (redesign guide 15): the club and week, the
 * headline line, the admin's note and Claude's summary when there are
 * any, then one row per item (what got done, who came, decisions, new
 * members, next week), and "Money moved" only when the recipient holds a
 * finance role (the job decides, per recipient). In the shared Moonstone
 * email layout (src/server/email/templates.ts), its fixed light colours.
 */

const C = EMAIL_COLORS;

function row(title: string, detail: string | null): string {
  return `<tr><td style="padding:12px 0;border-top:1px solid ${C.line}"><p style="margin:0;font-size:15px;font-weight:600;line-height:1.4;color:${C.ink}">${escapeHtml(title)}</p>${
    detail
      ? `<p style="margin:3px 0 0;font-size:14px;line-height:1.5;color:${C.muted}">${escapeHtml(detail)}</p>`
      : ""
  }</td></tr>`;
}

export function moneyMovedLine(finance: PulseFinance): { title: string; detail: string } {
  const pending = finance.pendingReimbursements;
  return {
    title: `Money moved: ${formatCents(finance.inCents)} in, ${formatCents(finance.outCents)} out`,
    detail:
      pending === 0
        ? "No expenses waiting for review."
        : `${pending} expense${pending === 1 ? "" : "s"} waiting for review.`,
  };
}

export function pulseEmail(input: {
  orgName: string;
  data: PulseIssueData;
  note: string | null;
  /** Only for finance roles; never for anyone else. */
  finance: PulseFinance | null;
  issueUrl: string;
}): RenderedEmail {
  const { data } = input;
  const title = pulseTitle(data.range);
  const headline = pulseHeadline(data);
  const rows = pulseRows(data);
  const money = input.finance ? moneyMovedLine(input.finance) : null;

  const lead = [input.data.summary, input.note ? input.note : null].filter((s): s is string =>
    Boolean(s),
  );

  const bodyHtml =
    `<p style="margin:0 0 4px;font-size:22px;font-weight:700;line-height:1.25;color:${C.ink}">${escapeHtml(title)}</p>` +
    `<p style="margin:0 0 18px;font-size:14px;color:${C.muted}">${escapeHtml(headline)}</p>` +
    lead
      .map(
        (text) =>
          `<p style="margin:0 0 14px;font-size:15px;line-height:1.55">${escapeHtml(text)}</p>`,
      )
      .join("") +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows
      .map((r) => row(r.title, r.detail))
      .join("")}${money ? row(money.title, money.detail) : ""}</table>`;

  const bodyText = [
    title,
    headline,
    ...lead,
    ...rows.map((r) => (r.detail ? `${r.title}\n${r.detail}` : r.title)),
    ...(money ? [`${money.title}\n${money.detail}`] : []),
  ].join("\n\n");

  return layout({
    subject: `${input.orgName}'s weekly pulse: ${headline}`,
    eyebrow: input.orgName,
    bodyHtml,
    bodyText,
    cta: { label: "Open the pulse", url: input.issueUrl },
    footer: "Turn off the weekly pulse email on your profile, under Notifications.",
  });
}
