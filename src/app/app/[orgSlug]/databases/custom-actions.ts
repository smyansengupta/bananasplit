"use server";

import { unstable_rethrow } from "next/navigation";
import { z } from "zod";

import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";
import {
  addChoice,
  addField,
  archiveDatabase,
  createDatabase,
  createRecord,
  DatabaseInputError,
  deleteField,
  loadRecords,
  moveField,
  purgeRecords,
  restoreRecords,
  trashRecords,
  updateCell,
  updateDatabaseSettings,
  updateField,
  type Actor,
  type CustomRecord,
  type FieldUpdate,
  type RecordPage,
} from "@/server/databases/custom";
import { AppError } from "@/server/db/errors";
import { withOrgAction, type OrgContext } from "@/server/db/context";
import type { Choice, FieldDef, StoredValue } from "@/lib/databases/fields";

/** Every action here belongs to databases (withOrgAction's space check). */
const databasesAction: typeof withOrgAction = (handler, options) =>
  withOrgAction(handler, { ...options, feature: "databases" });

/**
 * Server Actions of club-made databases (src/server/databases/custom.ts).
 * Each runs as the member (withOrgAction: app_user, RLS) and returns
 * { error } for anything expected; the grid calls updateCell on every edit,
 * which is how a database saves itself. A spreadsheet import posts its file
 * to a route handler instead (databases/import/route.ts): a Server Action's
 * body is capped at 1 MB, and a spreadsheet can be 4 MB.
 */

export interface Result<T = undefined> {
  error?: string;
  data?: T;
}

function actor(ctx: OrgContext): Actor {
  return { db: ctx.db, organizationId: ctx.organizationId, userId: ctx.userId, role: ctx.role };
}

function failure(error: unknown): { error: string } {
  unstable_rethrow(error);
  if (error instanceof DatabaseInputError) return { error: error.message };
  if (error instanceof NotFoundError)
    return { error: "That database or row no longer exists, or you can't see it." };
  if (error instanceof ForbiddenError) return { error: "You don't have permission to do that." };
  if (error instanceof AppError) return { error: error.message };
  // RLS refusing a write surfaces as a database error: say so plainly.
  const message = error instanceof Error ? error.message : "";
  if (/row-level security|permission denied/i.test(message)) {
    return { error: "You can view this database but not change it." };
  }
  console.error("[databases] action failed", error);
  return { error: "Something went wrong saving that. Try again." };
}

function action<Args extends unknown[], T>(fn: (a: Actor, ...args: Args) => Promise<T>) {
  const tx = databasesAction(async (ctx: OrgContext, ...args: Args) => fn(actor(ctx), ...args));
  return async (organizationId: string, ...args: Args): Promise<Result<T>> => {
    try {
      return { data: await tx(organizationId, ...args) };
    } catch (error) {
      return failure(error);
    }
  };
}

const id = z.string().min(1).max(100);
const ids = z.array(id).min(1).max(1000);

const newDatabase = z.object({
  name: z.string().max(200),
  description: z.string().max(2000).nullish(),
  templateId: z.string().max(40).optional(),
});

export const createDatabaseAction = action(async (a, input: unknown) => {
  const parsed = newDatabase.safeParse(input);
  if (!parsed.success) throw new DatabaseInputError("Check the database's name.");
  return createDatabase(a, parsed.data);
});

const settings = z.object({
  name: z.string().max(200),
  description: z.string().max(2000).nullable(),
  memberVisibility: z.enum(["MEMBERS", "ADMINS", "OWNER", "HIDDEN"]),
  memberCanEdit: z.boolean(),
});

export const updateDatabaseSettingsAction = action(
  async (a, databaseId: string, input: unknown) => {
    const parsed = settings.safeParse(input);
    if (!parsed.success || !id.safeParse(databaseId).success)
      throw new DatabaseInputError("Check the settings.");
    await updateDatabaseSettings(a, databaseId, parsed.data);
  },
);

export const archiveDatabaseAction = action(async (a, databaseId: string) => {
  await archiveDatabase(a, id.parse(databaseId));
});

const fieldInput = z.object({
  name: z.string().max(200).optional(),
  type: z.string().max(40).optional(),
  options: z.unknown().optional(),
  choicesVersion: z.string().max(40).optional(),
});

export const addFieldAction = action(
  async (a, databaseId: string, input: unknown): Promise<FieldDef> => {
    const parsed = fieldInput.safeParse(input);
    if (!parsed.success) throw new DatabaseInputError("Check the field.");
    return addField(a, id.parse(databaseId), {
      name: parsed.data.name ?? "",
      type: parsed.data.type ?? "TEXT",
      options: parsed.data.options,
    });
  },
);

export const updateFieldAction = action(
  async (a, fieldId: string, input: unknown): Promise<FieldUpdate> => {
    const parsed = fieldInput.safeParse(input);
    if (!parsed.success) throw new DatabaseInputError("Check the field.");
    return updateField(a, id.parse(fieldId), parsed.data);
  },
);

export const addChoiceAction = action(
  async (a, fieldId: string, label: string): Promise<{ field: FieldDef; choice: Choice }> => {
    const parsed = z.string().max(200).safeParse(label);
    if (!parsed.success) throw new DatabaseInputError("Keep a choice under 80 characters.");
    return addChoice(a, id.parse(fieldId), parsed.data);
  },
);

export const deleteFieldAction = action(async (a, fieldId: string) => {
  await deleteField(a, id.parse(fieldId));
});

export const moveFieldAction = action(async (a, fieldId: string, direction: -1 | 1) => {
  await moveField(a, id.parse(fieldId), direction === -1 ? -1 : 1);
});

const recordQuery = z.object({
  trash: z.boolean().optional(),
  q: z.string().max(200).optional(),
  after: z.string().max(200).nullish(),
  limit: z.number().int().min(1).max(10_000).optional(),
});

/** A page of rows: "Load more", a search, the export, a reload after a type change. */
export const loadRecordsAction = action(
  async (a, databaseId: string, query: unknown): Promise<RecordPage> => {
    const parsed = recordQuery.safeParse(query);
    if (!parsed.success) throw new DatabaseInputError("Check the search.");
    return loadRecords(a, id.parse(databaseId), parsed.data);
  },
);

export const createRecordAction = action(
  async (a, databaseId: string, values?: Record<string, unknown>): Promise<CustomRecord> =>
    createRecord(a, id.parse(databaseId), values ?? {}),
);

export const updateCellAction = action(
  async (a, recordId: string, fieldId: string, value: unknown): Promise<StoredValue | null> =>
    updateCell(a, id.parse(recordId), id.parse(fieldId), value),
);

export const trashRecordsAction = action(async (a, databaseId: string, recordIds: string[]) =>
  trashRecords(a, id.parse(databaseId), ids.parse(recordIds)),
);

export const restoreRecordsAction = action(async (a, databaseId: string, recordIds: string[]) =>
  restoreRecords(a, id.parse(databaseId), ids.parse(recordIds)),
);

export const purgeRecordsAction = action(
  async (a, databaseId: string, recordIds: string[] | "all") =>
    purgeRecords(a, id.parse(databaseId), recordIds === "all" ? "all" : ids.parse(recordIds)),
);
