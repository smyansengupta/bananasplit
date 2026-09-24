import { escapeHtml, subjectLine } from "@/server/email/escape";
import { layout, paragraph, type RenderedEmail } from "@/server/email/templates";

/**
 * Task email templates (Phase 6). Every value is escaped (escapeHtml), every
 * link is an absolute app URL (appUrl, checked again by safeHref in the
 * layout), and every message has a plain-text part. Titles and names are
 * member-controlled text: they never become markup.
 */

const FOOTER = "Change which task emails you get in your profile's notification settings.";

export interface TaskFacts {
  title: string;
  /** "Fri, Oct 3", or null for no due date. */
  dueLabel: string | null;
  priority?: string | null;
  projectName?: string | null;
  parentTitle?: string | null;
  status?: string | null;
  blockedReason?: string | null;
}

function factRows(facts: TaskFacts): [string, string][] {
  const rows: [string, string][] = [["Task", facts.title]];
  if (facts.parentTitle) rows.push(["Part of", facts.parentTitle]);
  rows.push(["Due", facts.dueLabel ?? "No due date"]);
  if (facts.priority) rows.push(["Priority", facts.priority]);
  if (facts.projectName) rows.push(["Project", facts.projectName]);
  if (facts.status) rows.push(["Status", facts.status]);
  if (facts.blockedReason) rows.push(["Blocked on", facts.blockedReason]);
  return rows;
}

function factsHtml(facts: TaskFacts): string {
  const rows = factRows(facts)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#71717a;vertical-align:top;white-space:nowrap">${escapeHtml(k)}</td><td style="padding:4px 0;font-weight:${k === "Task" ? 600 : 400}">${escapeHtml(v)}</td></tr>`,
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;font-size:14px">${rows}</table>`;
}

function factsText(facts: TaskFacts): string {
  return factRows(facts)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

function note(text: string): string {
  return `<p style="margin:0 0 16px;padding:10px 12px;border-radius:6px;background:#fef3c7;color:#78350f;font-size:14px">${escapeHtml(text)}</p>`;
}

export const FLAGGED_NOTE =
  "Flagged: this was assigned from below your level in the org chart. That's allowed; accept it, or talk it over. You or an admin can acknowledge the flag on the task.";

/** Assignment (owner or collaborator), with the flag note for an above-level assignment. */
export function taskAssignedEmail(input: {
  orgName: string;
  actorName: string;
  role: "owner" | "collaborator";
  task: TaskFacts;
  flagged: boolean;
  url: string;
}): RenderedEmail {
  const verb = input.role === "owner" ? "assigned you" : "added you to";
  const lead =
    input.role === "owner"
      ? `${input.actorName} assigned you a task in ${input.orgName}. You're the owner.`
      : `${input.actorName} added you to a task in ${input.orgName}.`;
  return layout({
    subject: `${input.actorName} ${verb}: ${input.task.title}`,
    eyebrow: input.orgName,
    bodyHtml: paragraph(lead) + (input.flagged ? note(FLAGGED_NOTE) : "") + factsHtml(input.task),
    bodyText: [lead, input.flagged ? FLAGGED_NOTE : null, factsText(input.task)].filter(Boolean).join("\n\n"),
    cta: { label: "Open task", url: input.url },
    footer: FOOTER,
  });
}

/** One email for a bulk assignment, listing every title. */
export function taskBulkAssignedEmail(input: {
  orgName: string;
  actorName: string;
  items: string[];
  flagged: boolean;
  url: string;
}): RenderedEmail {
  const n = input.items.length;
  const lead = `${input.actorName} assigned you ${n} task${n === 1 ? "" : "s"} in ${input.orgName}:`;
  const list = input.items.map((t) => `<li style="margin:0 0 6px">${escapeHtml(t)}</li>`).join("");
  return layout({
    subject: `${input.actorName} assigned you ${n} task${n === 1 ? "" : "s"}`,
    eyebrow: input.orgName,
    bodyHtml:
      paragraph(lead) +
      (input.flagged ? note(FLAGGED_NOTE) : "") +
      `<ul style="margin:0 0 12px;padding-left:20px">${list}</ul>`,
    bodyText: [lead, input.flagged ? FLAGGED_NOTE : null, input.items.map((t) => `- ${t}`).join("\n")]
      .filter(Boolean)
      .join("\n\n"),
    cta: { label: "Open My Tasks", url: input.url },
    footer: FOOTER,
  });
}

/** A new request in an intake queue, to its triage owner. */
export function taskRequestFiledEmail(input: {
  orgName: string;
  actorName: string;
  task: TaskFacts;
  url: string;
}): RenderedEmail {
  const queue = input.task.projectName ?? "the intake queue";
  const lead = `${input.actorName} filed a request in ${queue}. Set its priority and owner.`;
  return layout({
    subject: `New request: ${input.task.title}`,
    eyebrow: input.orgName,
    bodyHtml: paragraph(lead) + factsHtml(input.task),
    bodyText: [lead, factsText(input.task)].join("\n\n"),
    cta: { label: "Triage request", url: input.url },
    footer: FOOTER,
  });
}

export function taskMentionedEmail(input: {
  orgName: string;
  actorName: string;
  where: "comment" | "description";
  excerpt: string | null;
  task: TaskFacts;
  url: string;
}): RenderedEmail {
  const lead = `${input.actorName} mentioned you in ${input.where === "comment" ? "a comment on" : "the description of"} a task in ${input.orgName}.`;
  const quote = input.excerpt
    ? `<blockquote style="margin:0 0 16px;padding:8px 12px;border-left:3px solid #d4d4d8;color:#3f3f46">${escapeHtml(input.excerpt)}</blockquote>`
    : "";
  return layout({
    subject: `${input.actorName} mentioned you: ${input.task.title}`,
    eyebrow: input.orgName,
    bodyHtml: paragraph(lead) + quote + factsHtml(input.task),
    bodyText: [lead, input.excerpt ? `"${input.excerpt}"` : null, factsText(input.task)].filter(Boolean).join("\n\n"),
    cta: { label: "Open task", url: input.url },
    footer: FOOTER,
  });
}

export function taskCommentedEmail(input: {
  orgName: string;
  actorName: string;
  excerpt: string | null;
  task: TaskFacts;
  url: string;
}): RenderedEmail {
  const lead = `${input.actorName} commented on a task you're on in ${input.orgName}.`;
  const quote = input.excerpt
    ? `<blockquote style="margin:0 0 16px;padding:8px 12px;border-left:3px solid #d4d4d8;color:#3f3f46">${escapeHtml(input.excerpt)}</blockquote>`
    : "";
  return layout({
    subject: `New comment: ${input.task.title}`,
    eyebrow: input.orgName,
    bodyHtml: paragraph(lead) + quote + factsHtml(input.task),
    bodyText: [lead, input.excerpt ? `"${input.excerpt}"` : null, factsText(input.task)].filter(Boolean).join("\n\n"),
    cta: { label: "Open task", url: input.url },
    footer: FOOTER,
  });
}

export function taskReminderEmail(input: {
  orgName: string;
  /** "tomorrow", "today", "in 3 days". */
  when: string;
  role: "owner" | "collaborator";
  task: TaskFacts;
  url: string;
}): RenderedEmail {
  const lead =
    input.role === "owner"
      ? `Reminder: a task you own is due ${input.when}.`
      : `Reminder: a task you're involved in is due ${input.when}.`;
  return layout({
    subject: `Due ${input.when}: ${input.task.title}`,
    eyebrow: input.orgName,
    bodyHtml: paragraph(lead) + factsHtml(input.task),
    bodyText: [lead, factsText(input.task)].join("\n\n"),
    cta: { label: "Open task", url: input.url },
    footer: FOOTER,
  });
}

export interface DigestItem {
  title: string;
  dueLabel: string | null;
  url: string;
  note?: string | null;
}

export interface DigestSections {
  overdue: DigestItem[];
  today: DigestItem[];
  thisWeek: DigestItem[];
  newlyAssigned: DigestItem[];
  mentioned: DigestItem[];
  blocked: DigestItem[];
}

export const DIGEST_SECTION_TITLES: Record<keyof DigestSections, string> = {
  overdue: "Overdue",
  today: "Due today",
  thisWeek: "Due this week",
  newlyAssigned: "Assigned to you in the last day",
  mentioned: "Mentioned you in the last day",
  blocked: "Blocked",
};

export function digestItemCount(s: DigestSections): number {
  return Object.values(s).reduce((n, items) => n + items.length, 0);
}

export function taskDigestEmail(input: {
  orgName: string;
  dateLabel: string;
  sections: DigestSections;
  url: string;
}): RenderedEmail {
  const keys = Object.keys(DIGEST_SECTION_TITLES) as (keyof DigestSections)[];
  const html: string[] = [];
  const text: string[] = [];
  for (const key of keys) {
    const items = input.sections[key];
    if (items.length === 0) continue;
    const title = `${DIGEST_SECTION_TITLES[key]} (${items.length})`;
    html.push(`<p style="margin:16px 0 6px;font-weight:600">${escapeHtml(title)}</p>`);
    html.push(
      `<ul style="margin:0 0 8px;padding-left:20px">${items
        .map((i) => {
          const due = i.dueLabel ? ` <span style="color:#71717a">&middot; ${escapeHtml(i.dueLabel)}</span>` : "";
          const extra = i.note ? ` <span style="color:#71717a">&middot; ${escapeHtml(i.note)}</span>` : "";
          return `<li style="margin:0 0 4px">${escapeHtml(i.title)}${due}${extra}</li>`;
        })
        .join("")}</ul>`,
    );
    text.push(
      `${title}\n${items
        .map((i) => `- ${i.title}${i.dueLabel ? ` (${i.dueLabel})` : ""}${i.note ? ` - ${i.note}` : ""}`)
        .join("\n")}`,
    );
  }
  return layout({
    subject: subjectLine(`Your tasks for ${input.dateLabel} in ${input.orgName}`),
    eyebrow: input.orgName,
    bodyHtml: paragraph(`Here's where your tasks stand today, ${input.dateLabel}.`) + html.join(""),
    bodyText: [`Here's where your tasks stand today, ${input.dateLabel}.`, ...text].join("\n\n"),
    cta: { label: "Open My Tasks", url: input.url },
    footer: "You get this daily digest because you turned it on in your profile.",
  });
}

export function weeklyUpdateReminderEmail(input: {
  orgName: string;
  weekLabel: string;
  counts: { done: number; next: number; blocked: number };
  url: string;
}): RenderedEmail {
  const lead = `Your Sunday update for the week of ${input.weekLabel} isn't posted yet. The helper has it drafted: ${input.counts.done} done, ${input.counts.next} next, ${input.counts.blocked} blocked.`;
  return layout({
    subject: `Post your Sunday update (${input.orgName})`,
    eyebrow: input.orgName,
    bodyHtml: paragraph(lead) + paragraph("Review it, add a note, and post it before Sunday night."),
    bodyText: `${lead}\n\nReview it, add a note, and post it before Sunday night.`,
    cta: { label: "Open the Sunday update", url: input.url },
    footer: FOOTER,
  });
}
