import type { DatabaseKind } from "@/generated/prisma/client";
import { loadFields } from "@/server/databases/custom";
import type { TxClient } from "@/server/db/context";

import type { DatabaseSource } from "../types";
import { attendanceSource } from "./attendance";
import { ballotChoicesSource, ballotsSource } from "./ballots";
import { crmCompaniesSource, crmPeopleSource, crmPipelineSource } from "./crm";
import { peopleSource } from "./people";
import { sessionsSource } from "./sessions";
import { signupsSource } from "./signups";

/**
 * The data source of each built-in database kind. CUSTOM definitions have
 * no source (they're the editable grid). The CRM's kinds have a source
 * built per definition, because their custom fields are columns
 * (loadSourceFor).
 */
const SOURCES: Partial<Record<DatabaseKind, Record<string, DatabaseSource>>> = {
  SESSIONS: { default: sessionsSource },
  ATTENDANCE: { default: attendanceSource },
  SIGNUPS: { default: signupsSource },
  PEOPLE: { default: peopleSource },
  BALLOTS: { default: ballotChoicesSource, choices: ballotChoicesSource, ballots: ballotsSource },
};

const CRM_KINDS: ReadonlySet<DatabaseKind> = new Set(["CRM_PEOPLE", "CRM_COMPANIES", "CRM_PIPELINE"]);

export function isCrmKind(kind: DatabaseKind): boolean {
  return CRM_KINDS.has(kind);
}

/** A built-in kind's source (null for CUSTOM and the CRM's kinds: use loadSourceFor). */
export function sourceFor(kind: DatabaseKind, view?: string | null): DatabaseSource | null {
  const views = SOURCES[kind];
  if (!views) return null;
  return (view && views[view]) || views.default || null;
}

export function hasSource(kind: DatabaseKind): boolean {
  return Boolean(SOURCES[kind]) || CRM_KINDS.has(kind);
}

/**
 * The source of one database: a built-in kind's, or for the CRM's, one
 * built from the definition's custom fields (and a pipeline's stages).
 */
export async function loadSourceFor(
  db: TxClient,
  organizationId: string,
  database: { id: string; kind: DatabaseKind },
  view?: string | null,
): Promise<DatabaseSource | null> {
  if (!CRM_KINDS.has(database.kind)) return sourceFor(database.kind, view);
  const fields = await loadFields(db, organizationId, database.id);
  if (database.kind === "CRM_PEOPLE") {
    const settings = await db.crmSettings.findUnique({
      where: { organizationId },
      select: { relationshipTypes: true },
    });
    const types = (Array.isArray(settings?.relationshipTypes) ? settings.relationshipTypes : []) as {
      id: string;
      label: string;
    }[];
    return crmPeopleSource(fields, types);
  }
  if (database.kind === "CRM_COMPANIES") return crmCompaniesSource(fields);
  const pipeline = await db.crmPipeline.findFirst({
    where: { organizationId, databaseId: database.id },
    select: {
      id: true,
      itemNoun: true,
      hasAmount: true,
      stages: { orderBy: { sortOrder: "asc" }, select: { id: true, name: true, kind: true } },
    },
  });
  return pipeline ? crmPipelineSource(pipeline, fields) : null;
}

export { attendanceSource, ballotChoicesSource, ballotsSource, peopleSource, sessionsSource, signupsSource };
