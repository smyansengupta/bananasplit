import "server-only";

import { z } from "zod";

import { NotFoundError } from "@/lib/auth/errors";
import { displayText, type FieldDef } from "@/lib/databases/fields";
import {
  createRecord,
  DatabaseInputError,
  loadFields,
  updateCell,
  type Actor,
} from "@/server/databases/custom";
import { getDatabase, type DatabaseSummary } from "@/server/databases/views";
import type { OrgContext } from "@/server/db/context";

import { DATABASES, fieldKeys, memberNames, valueField, type Value } from "./databases";
import { itemId, memberOf, refOf } from "./ids";
import {
  ConnectorInputError,
  itemArg,
  readResult,
  spaceRef,
  urlField,
  type ConnectorSession,
  type ToolRegistrar,
} from "./shared";
import type { ToolSpace } from "./space";
import { ADDS, OVERWRITES, WriteRefusedError, writeInSpace } from "./write";

/**
 * add_database_record and update_database_record
 * (docs/features/ai-connectors.md, Phase 3): rows of the databases a club
 * made, through the grid's own createRecord and updateCell
 * (src/server/databases/custom.ts), so app.can_edit_database and each
 * column's type check every value. The built-in databases (sessions,
 * attendance, sign-ups, ballots, people) stay read-only here.
 *
 * Cells are keyed by the column keys query_database lists (field names, the
 * second of a name as "Name (2)"), and read back as the grid shows them.
 */

const rowId = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, "Use a row id from query_database")
  .describe("The row's id, as query_database returned it.");

const cellArg = z
  .union([
    z.string().max(10_000),
    z.number(),
    z.boolean(),
    z.array(z.string().max(500)).max(100),
    z.null(),
  ])
  .describe(
    'Text, a number, true or false, a day (yyyy-mm-dd), a choice\'s label (a list of them for a multi-select), or "me" or a member id from list_members for a member column. null clears the cell.',
  );

const valuesArg = z
  .record(z.string().min(1).max(200), cellArg)
  .refine((values) => Object.keys(values).length <= 100, "Set at most 100 cells at once")
  .describe("The cells, by the column keys query_database lists.");

const rowOutput = z.object({
  space: spaceRef,
  database: z.object({ id: z.string(), name: z.string(), url: urlField }),
  row: z.object({ id: z.string(), values: z.record(z.string(), valueField) }),
});

type RowOutput = z.infer<typeof rowOutput>;

interface CustomDatabase {
  database: DatabaseSummary;
  fields: FieldDef[];
  keys: string[];
}

function actorOf(ctx: OrgContext): Actor {
  return { db: ctx.db, organizationId: ctx.organizationId, userId: ctx.userId, role: ctx.role };
}

/** A database the member can open that the club made; built-in ones are refused. */
async function customDatabase(
  ctx: OrgContext,
  space: ToolSpace,
  key: string,
): Promise<CustomDatabase> {
  const database = await getDatabase(ctx.db, space.id, ctx.role, key);
  if (database.kind !== "CUSTOM") {
    throw new ConnectorInputError(
      "Only databases the club made take rows from here. The built-in ones (sessions, attendance, sign-ups, ballots, people) change on their own pages in Bananasplit.",
    );
  }
  const fields = await loadFields(ctx.db, space.id, database.id);
  return { database, fields, keys: fieldKeys(fields) };
}

/** The values as field ids and what the grid takes for them (member ids for member columns). */
function cellsOf(
  table: CustomDatabase,
  values: Record<string, z.infer<typeof cellArg>>,
  space: ToolSpace,
  me: string,
): { field: FieldDef; value: unknown }[] {
  return Object.entries(values).map(([key, raw]) => {
    const field = table.fields[table.keys.indexOf(key)];
    if (!field) {
      throw new ConnectorInputError(
        "Each key in values is a column key of this database, as query_database lists them.",
      );
    }
    if (field.type !== "MEMBER" || typeof raw !== "string") return { field, value: raw };
    const userId = memberOf(raw, space.id, me);
    if (!userId) {
      throw new ConnectorInputError(
        `${field.name} takes "me" or a member id from list_members for this space.`,
      );
    }
    return { field, value: userId };
  });
}

/** The grid's own refusals (a value that doesn't fit, no edit rights), in its words. */
async function gridWrite<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof DatabaseInputError) throw new WriteRefusedError(error.message);
    throw error;
  }
}

async function rowOf(
  ctx: OrgContext,
  space: ToolSpace,
  table: CustomDatabase,
  recordId: string,
): Promise<RowOutput> {
  const record = await ctx.db.databaseRecord.findFirst({
    where: {
      id: recordId,
      organizationId: space.id,
      databaseId: table.database.id,
      deletedAt: null,
    },
    select: { id: true, values: true },
  });
  if (!record) throw new NotFoundError();
  const stored = (record.values ?? {}) as Record<string, unknown>;
  const names = await memberNames(ctx, space.id, table.fields);
  const { database } = table;
  return {
    space: { id: space.id, name: space.name },
    database: {
      id: itemId("database", space.id, database.key),
      name: database.name,
      url: space.url(`/databases/${database.key}`),
    },
    row: {
      id: record.id,
      values: Object.fromEntries(
        table.fields.map((f, i): [string, Value] => [
          table.keys[i]!,
          displayText(f, stored[f.id], names) || null,
        ]),
      ),
    },
  };
}

// ---------------------------------------------------------------- add_database_record

const addInput = z.object({
  id: itemArg("database"),
  values: valuesArg.default({}),
});

export async function addDatabaseRecordTool(
  session: ConnectorSession,
  raw: z.input<typeof addInput>,
): Promise<RowOutput> {
  const args = addInput.parse(raw);
  const ref = refOf(args.id, "database");
  return writeInSpace(
    session,
    "add_database_record",
    ref.spaceId,
    DATABASES,
    async (ctx, space) => {
      const table = await customDatabase(ctx, space, ref.id);
      const cells = cellsOf(table, args.values, space, ctx.userId);
      const record = await gridWrite(() =>
        createRecord(
          actorOf(ctx),
          table.database.id,
          Object.fromEntries(cells.map((c) => [c.field.id, c.value])),
        ),
      );
      return {
        output: await rowOf(ctx, space, table, record.id),
        target: { type: "DatabaseRecord", id: record.id },
      };
    },
  );
}

// ---------------------------------------------------------------- update_database_record

const updateInput = z.object({
  id: itemArg("database"),
  row: rowId,
  values: valuesArg.refine((values) => Object.keys(values).length > 0, "Set at least one cell"),
});

export async function updateDatabaseRecordTool(
  session: ConnectorSession,
  raw: z.input<typeof updateInput>,
): Promise<RowOutput> {
  const args = updateInput.parse(raw);
  const ref = refOf(args.id, "database");
  return writeInSpace(
    session,
    "update_database_record",
    ref.spaceId,
    DATABASES,
    async (ctx, space) => {
      const table = await customDatabase(ctx, space, ref.id);
      const cells = cellsOf(table, args.values, space, ctx.userId);
      // updateCell finds the row through its field, so a row of another database isn't found.
      for (const cell of cells) {
        await gridWrite(() => updateCell(actorOf(ctx), args.row, cell.field.id, cell.value));
      }
      return {
        output: await rowOf(ctx, space, table, args.row),
        target: { type: "DatabaseRecord", id: args.row },
      };
    },
  );
}

// ---------------------------------------------------------------- registration

export const registerDatabaseWrites: ToolRegistrar = (server, session) => {
  server.registerTool(
    "add_database_record",
    {
      title: "Add a database row",
      description:
        "Adds a row to a database the club made, with any cells given by column key. Each value must fit its column, as in the app; built-in databases can't be changed here.",
      inputSchema: addInput,
      outputSchema: rowOutput,
      annotations: ADDS,
    },
    (args) => readResult("add_database_record", () => addDatabaseRecordTool(session, args)),
  );
  server.registerTool(
    "update_database_record",
    {
      title: "Update a database row",
      description:
        "Sets cells of one row in a database the club made, by column key; cells left out stay as they are, and null clears one. Built-in databases can't be changed here.",
      inputSchema: updateInput,
      outputSchema: rowOutput,
      annotations: OVERWRITES,
    },
    (args) => readResult("update_database_record", () => updateDatabaseRecordTool(session, args)),
  );
};
