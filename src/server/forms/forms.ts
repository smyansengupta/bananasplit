import type { Prisma } from "@/generated/prisma/client";
import type { FormAccess, FormKind, FormResponseStatus } from "@/generated/prisma/enums";
import { can } from "@/lib/auth/permissions";
import { CHOICE_COLORS, readOptions, type Choice, type FieldType } from "@/lib/databases/fields";
import {
  FORM_LIMITS,
  QUESTION_META,
  findTemplate,
  hasOptions,
  newSlug,
  questionsSchema,
  readQuestions,
  takesAnswer,
  type Question,
} from "@/lib/forms/questions";
import { slugify } from "@/lib/slug";
import { addField, DatabaseInputError, type Actor } from "@/server/databases/custom";
import type { TxClient } from "@/server/db/context";

/**
 * Forms (docs/features/forms.md): making and changing a form, as an owner
 * or admin (RLS on Form insists), and reading its responses. Each form owns
 * a club database, made with it: a "Response" column that names each row
 * (who answered, or "Response 12"), then one column per question. Questions
 * keep their column through renames and moves; a question removed keeps
 * its column (and the answers in it), so nothing anyone sent is lost.
 */

export class FormInputError extends DatabaseInputError {}

function requireManage(actor: Actor) {
  if (!can({ role: actor.role }, "databases.write")) {
    throw new FormInputError("Only owners and admins can make and change forms.");
  }
}

export const FORM_SELECT = {
  id: true,
  organizationId: true,
  databaseId: true,
  kind: true,
  title: true,
  description: true,
  slug: true,
  questions: true,
  access: true,
  onePerPerson: true,
  anonymous: true,
  hideResultsUntilClosed: true,
  responseCap: true,
  closesAt: true,
  closedAt: true,
  notifyOwner: true,
  review: true,
  folderId: true,
  createdById: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.FormSelect;

export type FormRow = Prisma.FormGetPayload<{ select: typeof FORM_SELECT }>;

/** Open while not closed by hand, before its closing time, under its cap. */
export function isFormOpen(
  form: Pick<FormRow, "closedAt" | "closesAt" | "responseCap" | "deletedAt">,
  responses: number,
  now = new Date(),
): boolean {
  if (form.deletedAt || form.closedAt) return false;
  if (form.closesAt && form.closesAt <= now) return false;
  if (form.responseCap !== null && responses >= form.responseCap) return false;
  return true;
}

// ---- Listing -------------------------------------------------------------

export interface FormListItem {
  form: FormRow;
  responses: number;
  toReview: number;
  databaseKey: string;
}

export async function listForms(db: TxClient, organizationId: string): Promise<FormListItem[]> {
  const forms = await db.form.findMany({
    where: { organizationId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: { ...FORM_SELECT, database: { select: { key: true } } },
  });
  if (forms.length === 0) return [];
  const ids = forms.map((f) => f.id);
  const [all, fresh] = await Promise.all([
    db.formResponse.groupBy({
      by: ["formId"],
      where: { organizationId, formId: { in: ids }, record: { deletedAt: null } },
      _count: { _all: true },
    }),
    db.formResponse.groupBy({
      by: ["formId"],
      where: { organizationId, formId: { in: ids }, status: "NEW", record: { deletedAt: null } },
      _count: { _all: true },
    }),
  ]);
  return forms.map(({ database, ...form }) => ({
    form,
    responses: all.find((c) => c.formId === form.id)?._count._all ?? 0,
    toReview: form.review ? (fresh.find((c) => c.formId === form.id)?._count._all ?? 0) : 0,
    databaseKey: database.key,
  }));
}

export async function loadForm(db: TxClient, organizationId: string, formId: string) {
  return db.form.findFirst({
    where: { id: formId, organizationId },
    select: { ...FORM_SELECT, database: { select: { key: true, name: true } } },
  });
}

// ---- Making a form -------------------------------------------------------

async function uniqueDatabaseKey(db: TxClient, organizationId: string, title: string) {
  const base = `form-${slugify(title).slice(0, 40) || "responses"}`;
  const taken = new Set(
    (
      await db.databaseDefinition.findMany({
        where: { organizationId, key: { startsWith: base } },
        select: { key: true },
      })
    ).map((d) => d.key),
  );
  for (let n = 1; n < 1000; n++) {
    const key = n === 1 ? base : `${base}-${n}`;
    if (!taken.has(key)) return key;
  }
  return `${base}-${newSlug()}`;
}

async function uniqueSlug(db: TxClient): Promise<string> {
  // The slug is global (it's the public link) and random; a clash is
  // vanishingly rare, but checking is cheap. The public lookup is the
  // service path's, so this checks the org's own forms only and the unique
  // index catches the rest.
  for (let i = 0; i < 5; i++) {
    const slug = newSlug();
    if ((await db.form.count({ where: { slug } })) === 0) return slug;
  }
  return newSlug() + newSlug().slice(0, 4);
}

/** Short enough for a column name. */
function columnName(q: Question, index: number): string {
  const t = q.title.trim().replace(/\s+/g, " ");
  if (!t) return `Question ${index + 1}`;
  return t.length > 60 ? `${t.slice(0, 57)}...` : t;
}

/** The field type a question writes into (null: it doesn't write). */
export function fieldTypeOf(q: Question): FieldType | null {
  return takesAnswer(q.type) ? QUESTION_META[q.type].field : null;
}

/** The options as database choices, keeping each existing choice's colour. */
function choicesFor(q: Question, existing: readonly Choice[]): Choice[] {
  const byId = new Map(existing.map((c) => [c.id, c]));
  const fromForm = (q.options ?? []).map((o, i) => ({
    id: o.id,
    label: o.label,
    color: byId.get(o.id)?.color ?? CHOICE_COLORS[(i + 1) % CHOICE_COLORS.length]!,
  }));
  // Choices added by "Other" answers stay, after the form's own.
  const extra = existing.filter((c) => !fromForm.some((f) => f.id === c.id));
  return [...fromForm, ...extra];
}

export async function createForm(
  actor: Actor,
  input: { templateId?: string; title?: string; kind?: FormKind; questions?: Question[] },
): Promise<{ id: string }> {
  requireManage(actor);
  const { db, organizationId, userId } = actor;
  const template = findTemplate(input.templateId);
  const title = (input.title?.trim() || template.title).slice(0, FORM_LIMITS.title);
  const questions = questionsSchema.parse(input.questions ?? template.questions());

  // The Files folder uploads go into, named after the form.
  const folder = await db.noteFolder.create({
    data: { organizationId, name: title.slice(0, 80), createdById: userId },
    select: { id: true },
  });
  const last = await db.databaseDefinition.aggregate({
    where: { organizationId },
    _max: { sortOrder: true },
  });
  const database = await db.databaseDefinition.create({
    data: {
      organizationId,
      key: await uniqueDatabaseKey(db, organizationId, title),
      name: title.slice(0, 60),
      description: "Responses to a form",
      icon: "ClipboardList",
      kind: "CUSTOM",
      // Answers are the club's to see, not every member's: owners and
      // admins, until someone opens the database up.
      memberVisibility: "ADMINS",
      allowEdits: true,
      sortOrder: (last._max.sortOrder ?? 0) + 1,
      createdById: userId,
    },
    select: { id: true },
  });
  await db.databaseField.create({
    data: {
      organizationId,
      databaseId: database.id,
      name: "Response",
      type: "TEXT",
      isPrimary: true,
      sortOrder: 0,
      options: {},
    },
  });
  const form = await db.form.create({
    data: {
      organizationId,
      databaseId: database.id,
      kind: input.kind ?? "FORM",
      title,
      slug: await uniqueSlug(db),
      questions: [],
      review: template.review,
      folderId: folder.id,
      createdById: userId,
      // A quick poll from Forms: anyone with the link, results after you answer.
      ...(input.kind === "QUICK_POLL" ? { notifyOwner: false } : {}),
    },
    select: { id: true },
  });
  await saveQuestions(actor, form.id, questions);
  return form;
}

/**
 * Saves the questions and brings the database along: a column for each
 * question that takes an answer (made when it's new, or when its type
 * changes to one that stores differently), renamed with it, its choices
 * kept in step with the options.
 */
export async function saveQuestions(
  actor: Actor,
  formId: string,
  raw: unknown,
): Promise<Question[]> {
  requireManage(actor);
  const parsed = questionsSchema.safeParse(raw);
  if (!parsed.success)
    throw new FormInputError("Something in those questions doesn't fit. Reload and try again.");
  const { db, organizationId } = actor;
  const form = await db.form.findFirst({
    where: { id: formId, organizationId, deletedAt: null },
    select: { id: true, databaseId: true },
  });
  if (!form) throw new FormInputError("That form is gone.");
  const fields = await db.databaseField.findMany({
    where: { organizationId, databaseId: form.databaseId },
    select: { id: true, name: true, type: true, options: true, sortOrder: true },
  });
  const byId = new Map(fields.map((f) => [f.id, f]));
  const questions: Question[] = [];
  for (const [index, q] of parsed.data.entries()) {
    const type = fieldTypeOf(q);
    if (!type) {
      questions.push({ ...q, fieldId: undefined });
      continue;
    }
    let field = q.fieldId ? byId.get(q.fieldId) : undefined;
    if (field && field.type !== type) field = undefined;
    const name = columnName(q, index);
    if (!field) {
      const made = await addField(actor, form.databaseId, {
        name,
        type,
        options: hasOptions(q.type) && type !== "LONG_TEXT" ? { choices: choicesFor(q, []) } : {},
      });
      questions.push({ ...q, fieldId: made.id });
      continue;
    }
    const options = readOptions(field.options);
    const choices =
      hasOptions(q.type) && type !== "LONG_TEXT" ? choicesFor(q, options.choices ?? []) : undefined;
    const sortOrder = index + 1;
    if (
      field.name !== name ||
      field.sortOrder !== sortOrder ||
      (choices && JSON.stringify(choices) !== JSON.stringify(options.choices ?? []))
    ) {
      await db.databaseField.update({
        where: { id: field.id },
        data: {
          name,
          sortOrder,
          ...(choices ? { options: { ...options, choices } as Prisma.InputJsonObject } : {}),
        },
      });
    }
    questions.push({ ...q, fieldId: field.id });
  }
  await db.form.update({
    where: { id: formId },
    data: { questions: questions as unknown as Prisma.InputJsonArray },
  });
  return questions;
}

export interface FormSettings {
  title?: string;
  description?: string | null;
  access?: FormAccess;
  onePerPerson?: boolean;
  anonymous?: boolean;
  hideResultsUntilClosed?: boolean;
  responseCap?: number | null;
  closesAt?: Date | null;
  notifyOwner?: boolean;
  review?: boolean;
}

export async function saveSettings(actor: Actor, formId: string, patch: FormSettings) {
  requireManage(actor);
  const data: Prisma.FormUpdateInput = {};
  if (patch.title !== undefined) {
    const t = patch.title.trim();
    if (!t) throw new FormInputError("Give the form a title.");
    data.title = t.slice(0, FORM_LIMITS.title);
  }
  if (patch.description !== undefined) data.description = patch.description?.trim() || null;
  if (patch.access !== undefined) {
    data.access = patch.access;
    if (patch.access === "SIGNED_IN") data.onePerPerson = true;
  }
  if (patch.onePerPerson !== undefined) data.onePerPerson = patch.onePerPerson;
  if (patch.anonymous !== undefined) data.anonymous = patch.anonymous;
  if (patch.hideResultsUntilClosed !== undefined)
    data.hideResultsUntilClosed = patch.hideResultsUntilClosed;
  if (patch.responseCap !== undefined) data.responseCap = patch.responseCap;
  if (patch.closesAt !== undefined) data.closesAt = patch.closesAt;
  if (patch.notifyOwner !== undefined) data.notifyOwner = patch.notifyOwner;
  if (patch.review !== undefined) data.review = patch.review;
  const updated = await actor.db.form.updateMany({
    where: { id: formId, organizationId: actor.organizationId, deletedAt: null },
    data: data as Prisma.FormUpdateManyMutationInput,
  });
  if (updated.count === 0) throw new FormInputError("That form is gone.");
  // The database is named after the form.
  if (data.title) {
    const form = await actor.db.form.findFirst({
      where: { id: formId, organizationId: actor.organizationId },
      select: { databaseId: true },
    });
    if (form)
      await actor.db.databaseDefinition.update({
        where: { id: form.databaseId },
        data: { name: String(data.title).slice(0, 60) },
      });
  }
}

/** Closes or reopens by hand. */
export async function setClosed(actor: Actor, formId: string, closed: boolean) {
  requireManage(actor);
  await actor.db.form.updateMany({
    where: { id: formId, organizationId: actor.organizationId },
    data: { closedAt: closed ? new Date() : null },
  });
}

/** Moves a form to the trash (its database and answers stay); Undo brings it back. */
export async function trashForm(actor: Actor, formId: string, trashed: boolean) {
  requireManage(actor);
  await actor.db.form.updateMany({
    where: { id: formId, organizationId: actor.organizationId },
    data: { deletedAt: trashed ? new Date() : null },
  });
}

// ---- Responses -------------------------------------------------------------

export interface ResponseRow {
  id: string;
  recordId: string;
  values: Record<string, unknown>;
  status: FormResponseStatus;
  rating: number | null;
  notes: string | null;
  userId: string | null;
  who: string;
  email: string | null;
  createdAt: Date;
}

export async function loadResponses(
  db: TxClient,
  organizationId: string,
  formId: string,
): Promise<{ rows: ResponseRow[]; choices: Map<string, Choice[]> }> {
  const form = await db.form.findFirst({
    where: { id: formId, organizationId },
    select: { databaseId: true },
  });
  if (!form) return { rows: [], choices: new Map() };
  const [responses, fields] = await Promise.all([
    db.formResponse.findMany({
      where: { organizationId, formId, record: { deletedAt: null } },
      orderBy: { createdAt: "desc" },
      take: 2000,
      select: {
        id: true,
        recordId: true,
        status: true,
        rating: true,
        notes: true,
        userId: true,
        email: true,
        createdAt: true,
        record: { select: { values: true } },
      },
    }),
    db.databaseField.findMany({
      where: { organizationId, databaseId: form.databaseId },
      select: { id: true, isPrimary: true, options: true },
    }),
  ]);
  const primary = fields.find((f) => f.isPrimary)?.id;
  const choices = new Map(fields.map((f) => [f.id, readOptions(f.options).choices ?? []]));
  return {
    choices,
    rows: responses.map((r) => {
      const values = (r.record.values ?? {}) as Record<string, unknown>;
      return {
        id: r.id,
        recordId: r.recordId,
        values,
        status: r.status,
        rating: r.rating,
        notes: r.notes,
        userId: r.userId,
        email: r.email,
        createdAt: r.createdAt,
        who:
          primary && typeof values[primary] === "string" ? (values[primary] as string) : "Response",
      };
    }),
  };
}

export async function reviewResponse(
  actor: Actor,
  responseId: string,
  patch: { status?: FormResponseStatus; rating?: number | null; notes?: string | null },
) {
  requireManage(actor);
  const data: Prisma.FormResponseUpdateManyMutationInput = { reviewedById: actor.userId };
  if (patch.status) data.status = patch.status;
  if (patch.rating !== undefined) {
    if (patch.rating !== null && (patch.rating < 1 || patch.rating > 5))
      throw new FormInputError("Rate it 1 to 5.");
    data.rating = patch.rating;
  }
  if (patch.notes !== undefined) data.notes = patch.notes?.slice(0, 4000) || null;
  const updated = await actor.db.formResponse.updateMany({
    where: { id: responseId, organizationId: actor.organizationId },
    data,
  });
  if (updated.count === 0) throw new FormInputError("That response is gone.");
}

/** Counts of responses waiting on a review, for forms this person owns (Inbox). */
export async function toReviewForOwner(db: TxClient, organizationId: string, userId: string) {
  const forms = await db.form.findMany({
    where: { organizationId, createdById: userId, review: true, deletedAt: null },
    select: { id: true, title: true },
  });
  if (forms.length === 0) return [];
  const counts = await db.formResponse.groupBy({
    by: ["formId"],
    where: {
      organizationId,
      formId: { in: forms.map((f) => f.id) },
      status: "NEW",
      record: { deletedAt: null },
    },
    _count: { _all: true },
  });
  return forms
    .map((f) => ({ ...f, count: counts.find((c) => c.formId === f.id)?._count._all ?? 0 }))
    .filter((f) => f.count > 0);
}

export { readQuestions };
