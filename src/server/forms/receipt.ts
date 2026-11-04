import { readQuestions, takesAnswer, type Question } from "@/lib/forms/questions";
import { withSystemOrgTx } from "@/server/db/context";
import { getOrgMailer } from "@/server/email/mailer";
import { escapeHtml } from "@/server/email/escape";
import { layout, paragraph } from "@/server/email/templates";

import type { FormTarget } from "./public";

/**
 * A copy of someone's answers, emailed to them when the form asks for a
 * receipt (Settings › Email a copy) and they gave an email. Sent from the
 * organization's own sender when it has one, else the platform's. A
 * receipt that can't be sent never fails the answer itself.
 */
export async function sendFormReceipt(target: FormTarget, responseId: string): Promise<void> {
  const data = await withSystemOrgTx(target.organizationId, async ({ db }) => {
    const form = await db.form.findFirst({
      where: { id: target.formId, organizationId: target.organizationId },
      select: { title: true, receipt: true, anonymous: true, questions: true },
    });
    if (!form || !form.receipt || form.anonymous) return null;
    const response = await db.formResponse.findFirst({
      where: { id: responseId, organizationId: target.organizationId, formId: target.formId },
      select: { email: true, record: { select: { values: true } } },
    });
    if (!response?.email) return null;
    const org = await db.organization.findUnique({
      where: { id: target.organizationId },
      select: { name: true },
    });
    return {
      title: form.title,
      email: response.email,
      orgName: org?.name ?? "",
      questions: readQuestions(form.questions),
      values: (response.record.values ?? {}) as Record<string, unknown>,
    };
  });
  if (!data) return;
  const mailer = await getOrgMailer(target.organizationId);
  if (!mailer) return;
  const lines = answerLines(data.questions, data.values);
  const subject = `Your answers: ${data.title}`;
  const html =
    paragraph(`Here's what you sent to ${data.orgName}.`) +
    lines
      .map(
        (l) =>
          `<p style="margin:0 0 12px"><span style="display:block;font-size:13px;color:#6b6b6b">${escapeHtml(l.q)}</span>${escapeHtml(l.a)}</p>`,
      )
      .join("");
  const text = [
    `Here's what you sent to ${data.orgName}.`,
    ...lines.map((l) => `${l.q}\n${l.a}`),
  ].join("\n\n");
  await mailer.send({
    ...layout({
      subject,
      eyebrow: data.orgName,
      bodyHtml: `<p style="margin:0 0 14px;font-size:18px;font-weight:600;line-height:1.35">${escapeHtml(data.title)}</p>${html}`,
      bodyText: `${data.title}\n\n${text}`,
      footer: "You asked for a copy when you answered this form.",
    }),
    to: data.email,
  });
}

/** Each answered question and its answer, in words. */
export function answerLines(
  questions: readonly Question[],
  values: Readonly<Record<string, unknown>>,
): { q: string; a: string }[] {
  const out: { q: string; a: string }[] = [];
  for (const q of questions) {
    if (!takesAnswer(q.type) || q.type === "hidden" || !q.fieldId) continue;
    const raw = values[q.fieldId];
    if (raw === undefined || raw === null || raw === "") continue;
    const label = (id: unknown) => (q.options ?? []).find((o) => o.id === id)?.label ?? String(id);
    let a: string;
    if (Array.isArray(raw)) a = raw.map(label).join(", ");
    else if (typeof raw === "boolean") a = raw ? "Yes" : "No";
    else if (q.type === "file" || q.type === "image" || q.type === "signature") a = "Sent";
    else if (q.options?.length) a = label(raw);
    else a = String(raw);
    out.push({ q: q.title || "Question", a });
  }
  return out;
}
