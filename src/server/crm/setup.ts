import type { Prisma } from "@/generated/prisma/client";
import {
  ALUMNI_KEEP_IN_TOUCH_DAYS,
  pipelinesFor,
  relationshipTypesFor,
  SETUP_KINDS,
  viewsFor,
  type SetupKind,
} from "@/lib/crm/templates";
import { enqueueJob } from "@/server/jobs/enqueue";

import { crmAccess, CrmError, type CrmActor } from "./access";
import { ensureCrmDatabases } from "./databases";
import { createPipelineFrom } from "./pipelines";
import { moveSponsorsIn, type SponsorsMoveResult } from "./sponsors";
import { ensurePipelineViews, ensureStarterReports } from "./starter";

/**
 * The CRM's one-step setup (docs/features/crm.md, "Organization setup in one
 * step"). "What do you mostly reach out to?" makes, in one transaction:
 * CrmSettings with the relationship types those answers use, People and
 * Companies in Databases, a ready-made pipeline per answer (each one a
 * database too), the saved views, and, when Finance has deals' partners,
 * the Deals pipeline with every partner and deal moved in. Run
 * again with more answers, it adds what's missing and changes nothing else.
 * Owners and admins only (RLS: CrmSettings is theirs to create).
 */

export interface SetupResult {
  pipelines: number;
  sponsors: SponsorsMoveResult | null;
}

export async function runSetup(actor: CrmActor, kindsInput: readonly string[]): Promise<SetupResult> {
  const access = await crmAccess(actor);
  if (!access.onPlan) throw new CrmError("The CRM comes with Team Advanced.");
  if (!access.added) throw new CrmError("Add the CRM on Integrations and apps first.");
  if (!access.admin) throw new CrmError("Ask an owner or admin to set up the CRM.");
  const { db, organizationId, userId } = actor;
  const picked = SETUP_KINDS.filter((k) => kindsInput.includes(k));
  const hasSponsors = (await db.sponsor.count({ where: { organizationId } })) > 0;
  // Finance's partners and deals come along whether or not they were picked.
  const kinds: SetupKind[] = hasSponsors && !picked.includes("sponsors") ? [...picked, "sponsors"] : picked;
  if (kinds.length === 0) throw new CrmError("Pick at least one.");

  const existing = access.settings;
  const types = relationshipTypesFor([...new Set([...(existing?.setupKinds ?? []), ...kinds])] as SetupKind[]);
  const mergedTypes = [
    ...(existing?.relationshipTypes ?? []),
    ...types.filter((t) => !(existing?.relationshipTypes ?? []).some((e) => e.id === t.id)),
  ];
  const setupKinds = [...new Set([...(existing?.setupKinds ?? []), ...kinds])];
  if (existing) {
    await db.crmSettings.update({
      where: { organizationId },
      data: {
        setupKinds,
        relationshipTypes: mergedTypes as unknown as Prisma.InputJsonArray,
        setupDoneAt: existing.setupDoneAt ?? new Date(),
      },
    });
  } else {
    await db.crmSettings.create({
      data: {
        organizationId,
        setupKinds,
        relationshipTypes: mergedTypes as unknown as Prisma.InputJsonArray,
        setupDoneAt: new Date(),
      },
    });
  }

  await ensureCrmDatabases(actor);

  const have = await db.crmPipeline.findMany({
    where: { organizationId, archivedAt: null },
    select: { template: true },
  });
  let order = have.length;
  let pipelines = 0;
  for (const t of pipelinesFor(kinds)) {
    if (have.some((h) => h.template === t.template)) continue;
    await createPipelineFrom(actor, t, order++);
    pipelines++;
  }

  const views = await db.crmView.findMany({
    where: { organizationId, objectKind: { in: ["people", "companies", "deals"] } },
    select: { objectKind: true, name: true },
  });
  for (const v of viewsFor(kinds)) {
    if (views.some((x) => x.objectKind === v.objectKind && x.name === v.name)) continue;
    await db.crmView.create({
      data: {
        organizationId,
        objectKind: v.objectKind,
        name: v.name,
        filters: v.filters as unknown as Prisma.InputJsonArray,
        shared: true,
        createdById: userId,
      },
    });
  }

  // Each pipeline's saved views and starter report, and the Outreach report on People.
  await ensurePipelineViews(actor);
  await ensureStarterReports(actor);

  const sponsors = hasSponsors ? await moveSponsorsIn(actor) : null;
  // The timeline fills from the workspace in the background.
  await enqueueJob(db, {
    orgId: organizationId,
    kind: "crm-refresh",
    key: organizationId,
    payload: {},
  });
  return { pipelines, sponsors };
}

/** Alumni setup: people tagged alumni get a keep-in-touch cadence when they have none. */
export async function applyAlumniCadence(actor: CrmActor): Promise<number> {
  const r = await actor.db.crmPerson.updateMany({
    where: {
      organizationId: actor.organizationId,
      relationship: "alumni",
      keepInTouchDays: null,
      deletedAt: null,
    },
    data: { keepInTouchDays: ALUMNI_KEEP_IN_TOUCH_DAYS },
  });
  return r.count;
}
