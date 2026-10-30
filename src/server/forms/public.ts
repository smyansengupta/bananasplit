import type { Prisma } from "@/generated/prisma/client";
import { appUrl } from "@/lib/app-url";
import { CHOICE_COLORS, parseCell, readOptions, type FieldDef } from "@/lib/databases/fields";
import { checkSubmission, OTHER, type Submission } from "@/lib/forms/answers";
import { readQuestions, type Question } from "@/lib/forms/questions";
import { summarize, type QuestionSummary } from "@/lib/forms/summary";
import { newId } from "@/lib/forms/questions";
import { withSystemOrgTx, type TxClient } from "@/server/db/context";

import { fieldTypeOf, FORM_SELECT, isFormOpen, type FormRow } from "./forms";

/**
 * The public side of a form (/f/{slug}): finding it without an org
 * context, and recording a response on the service path. Every check the
 * database can't make for an anonymous respondent is made here first: the
 * form is open, the person may answer (members only, or signed in, or one
 * each), and each answer fits its question and its column.
 */

const SLUG = /^[a-z0-9-]{4,64}$/;

export interface FormTarget {
  organizationId: string;
  formId: string;
}

export async function formPageTarget(slug: string): Promise<FormTarget | null> {
  if (!SLUG.test(slug)) return null;
  return withSystemOrgTx(null, async ({ db }) => {
    const rows = await db.$queryRaw<FormTarget[]>`
      SELECT "organizationId", "formId" FROM app.form_page(${slug})`;
    return rows[0] ?? null;
  });
}

export interface PublicForm {
  form: FormRow;
  questions: Question[];
  org: { name: string; slug: string };
  responses: number;
  open: boolean;
  /** Is this person a member (for members-only forms and the member picker)? */
  member: boolean;
  /** Have they answered already (one each)? */
  answered: boolean;
  /** Members, for a member question: id and name. */
  members: { id: string; name: string }[];
}

export async function loadPublicForm(
  slug: string,
  viewerId: string | null,
): Promise<PublicForm | null> {
  const target = await formPageTarget(slug);
  if (!target) return null;
  return withSystemOrgTx(target.organizationId, async ({ db }) => {
    const form = await db.form.findFirst({
      where: { id: target.formId, organizationId: target.organizationId, deletedAt: null },
      select: FORM_SELECT,
    });
    if (!form) return null;
    const org = await db.organization.findUnique({
      where: { id: target.organizationId },
      select: { name: true, slug: true },
    });
    if (!org) return null;
    const responses = await countResponses(db, form);
    const member = viewerId
      ? (await db.membership.count({
          where: { organizationId: form.organizationId, userId: viewerId },
        })) > 0
      : false;
    const answered =
      viewerId && form.onePerPerson
        ? (await db.formResponse.count({ where: { formId: form.id, userId: viewerId } })) > 0
        : false;
    const questions = readQuestions(form.questions);
    const members =
      member && questions.some((q) => q.type === "member")
        ? (
            await db.membership.findMany({
              where: { organizationId: form.organizationId },
              select: { user: { select: { id: true, name: true, email: true } } },
              take: 500,
            })
          ).map((m) => ({ id: m.user.id, name: m.user.name ?? m.user.email ?? "Member" }))
        : [];
    return {
      form,
      questions,
      org,
      responses,
      open: isFormOpen(form, responses),
      member,
      answered,
      members,
    };
  });
}

function countResponses(db: TxClient, form: Pick<FormRow, "id" | "organizationId">) {
  return db.formResponse.count({
    where: { organizationId: form.organizationId, formId: form.id, record: { deletedAt: null } },
  });
}

/** A quick poll's results, for respondents (when the form shows them). */
export async function publicResults(
  target: FormTarget,
): Promise<{ summary: QuestionSummary[]; total: number } | null> {
  return withSystemOrgTx(target.organizationId, async ({ db }) => {
    const form = await db.form.findFirst({
      where: { id: target.formId, organizationId: target.organizationId },
      select: FORM_SELECT,
    });
    if (!form) return null;
    const records = await db.databaseRecord.findMany({
      where: { organizationId: form.organizationId, databaseId: form.databaseId, deletedAt: null },
      select: { values: true },
      take: 5000,
    });
    const fields = await db.databaseField.findMany({
      where: { organizationId: form.organizationId, databaseId: form.databaseId },
      select: { id: true, options: true },
    });
    const choices = new Map(fields.map((f) => [f.id, readOptions(f.options).choices ?? []]));
    const questions = readQuestions(form.questions).filter(
      (q) =>
        q.type === "choice" ||
        q.type === "checkboxes" ||
        q.type === "dropdown" ||
        q.type === "yesno" ||
        q.type === "rating" ||
        q.type === "scale",
    );
    return {
      total: records.length,
      summary: summarize(
        questions,
        records.map((r) => ({ values: (r.values ?? {}) as Record<string, unknown> })),
        (id) => choices.get(id) ?? [],
      ),
    };
  });
}

export type SubmitResult =
  { ok: true; responseId: string } | { ok: false; error: string; errors?: Record<string, string> };

export interface Respondent {
  userId: string | null;
  name: string | null;
  email: string | null;
}

/**
 * Records one response. The caller has rate-limited and honeypot-checked
 * the request; this checks everything about the form and the answers.
 */
export async function submitResponse(
  target: FormTarget,
  submission: Submission,
  who: Respondent,
): Promise<SubmitResult> {
  return withSystemOrgTx(target.organizationId, { userId: who.userId }, async ({ db }) => {
    const form = await db.form.findFirst({
      where: { id: target.formId, organizationId: target.organizationId, deletedAt: null },
      select: FORM_SELECT,
    });
    if (!form) return { ok: false, error: "This form isn't taking answers." };
    const count = await countResponses(db, form);
    if (!isFormOpen(form, count))
      return { ok: false, error: "This form isn't taking answers any more." };

    if (form.access !== "ANYONE" && !who.userId)
      return { ok: false, error: "Sign in to answer this form." };
    if (form.access === "MEMBERS") {
      const member = await db.membership.count({
        where: { organizationId: form.organizationId, userId: who.userId! },
      });
      if (!member) return { ok: false, error: "Only members can answer this form." };
    }
    if ((form.onePerPerson || form.access === "SIGNED_IN") && who.userId) {
      const already = await db.formResponse.count({
        where: { formId: form.id, userId: who.userId },
      });
      if (already) return { ok: false, error: "You've already answered this form." };
    }

    const questions = readQuestions(form.questions);
    const { path, errors } = checkSubmission(questions, submission);
    if (Object.keys(errors).length > 0)
      return { ok: false, error: "Check the highlighted answers.", errors };

    const fields = await db.databaseField.findMany({
      where: { organizationId: form.organizationId, databaseId: form.databaseId },
      select: { id: true, name: true, type: true, options: true, isPrimary: true },
    });
    const byId = new Map(fields.map((f) => [f.id, f]));
    const members = new Set(
      (
        await db.membership.findMany({
          where: { organizationId: form.organizationId },
          select: { userId: true },
        })
      ).map((m) => m.userId),
    );
    const org = await db.organization.findUnique({
      where: { id: form.organizationId },
      select: { slug: true },
    });

    const values: Record<string, Prisma.InputJsonValue> = {};
    for (const q of path) {
      if (!q.fieldId || !fieldTypeOf(q)) continue;
      const field = byId.get(q.fieldId);
      if (!field) continue;
      const raw = submission.answers[q.id];
      if (raw === undefined || raw === null || raw === "") continue;
      let input: unknown = raw;
      const def: FieldDef = {
        id: field.id,
        name: field.name,
        type: field.type,
        options: readOptions(field.options),
        isPrimary: field.isPrimary,
      };

      if (
        (q.type === "choice" || q.type === "dropdown" || q.type === "checkboxes") &&
        q.allowOther
      ) {
        const text = submission.other[q.id]?.trim();
        const picks = Array.isArray(raw) ? raw : [raw];
        if (picks.includes(OTHER) && text) {
          const id = await choiceFor(db, def, text);
          input = q.type === "checkboxes" ? [...picks.filter((p) => p !== OTHER), id] : id;
          def.options = readOptions(
            (
              await db.databaseField.findUnique({
                where: { id: field.id },
                select: { options: true },
              })
            )?.options,
          );
        } else if (Array.isArray(raw)) {
          input = raw.filter((p) => p !== OTHER);
        }
      }
      if (q.type === "ranking" && Array.isArray(raw)) {
        const label = new Map((q.options ?? []).map((o) => [o.id, o.label]));
        input = raw.map((id, i) => `${i + 1}. ${label.get(id) ?? id}`).join("\n");
      }
      if (q.type === "yesno") input = raw === true;
      if ((q.type === "file" || q.type === "image") && typeof raw === "string") {
        const file = await db.orgFile.findFirst({
          where: {
            id: raw,
            organizationId: form.organizationId,
            folderId: form.folderId ?? undefined,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (!file)
          return {
            ok: false,
            error: "That upload didn't arrive. Try it again.",
            errors: { [q.id]: "Upload it again." },
          };
        input = appUrl(`/app/${org?.slug}/notes/files/${file.id}`);
      }
      const parsed = parseCell(def, input, members);
      if (!parsed.ok) return { ok: false, error: parsed.error, errors: { [q.id]: parsed.error } };
      if (parsed.value !== null) values[q.fieldId] = parsed.value;
    }

    // The row's name: who answered (unless it's anonymous), else the first
    // short answer, else its number.
    const primary = fields.find((f) => f.isPrimary);
    const firstShort = path.find(
      (q) => q.type === "short" && typeof submission.answers[q.id] === "string",
    );
    const emailQ = path.find(
      (q) => q.type === "email" && typeof submission.answers[q.id] === "string",
    );
    const email = !form.anonymous
      ? (who.email ?? (emailQ ? String(submission.answers[emailQ.id]).trim().toLowerCase() : null))
      : null;
    const label = form.anonymous
      ? `Response ${count + 1}`
      : (who.name ??
        (firstShort ? String(submission.answers[firstShort.id]).trim().slice(0, 200) : null) ??
        email ??
        `Response ${count + 1}`);
    if (primary) values[primary.id] = label;

    const record = await db.databaseRecord.create({
      data: {
        organizationId: form.organizationId,
        databaseId: form.databaseId,
        values,
        createdById: form.anonymous ? null : who.userId,
        updatedById: form.anonymous ? null : who.userId,
      },
      select: { id: true },
    });
    const response = await db.formResponse.create({
      data: {
        organizationId: form.organizationId,
        formId: form.id,
        recordId: record.id,
        userId: form.anonymous ? null : who.userId,
        email,
      },
      select: { id: true },
    });
    if (form.notifyOwner) {
      await db.notification.create({
        data: {
          organizationId: form.organizationId,
          userId: form.createdById,
          type: "FORM_RESPONSE",
          title: `New response: ${form.title}`.slice(0, 200),
          body: label,
          linkUrl: `/app/${org?.slug}/forms/${form.id}?tab=responses${form.review ? "&view=review" : ""}`,
        },
      });
    }
    return { ok: true, responseId: response.id };
  });
}

/** The id of the choice named `label` on a select field, adding it if it's new. */
async function choiceFor(db: TxClient, field: FieldDef, label: string): Promise<string> {
  const clean = label.replace(/\s+/g, " ").trim().slice(0, 80);
  const choices = field.options.choices ?? [];
  const found = choices.find((c) => c.label.toLowerCase() === clean.toLowerCase());
  if (found) return found.id;
  const id = newId();
  if (choices.length >= 100) return choices[choices.length - 1]!.id;
  await db.databaseField.update({
    where: { id: field.id },
    data: {
      options: {
        ...field.options,
        choices: [
          ...choices,
          { id, label: clean, color: CHOICE_COLORS[choices.length % CHOICE_COLORS.length]! },
        ],
      } as Prisma.InputJsonObject,
    },
  });
  return id;
}
