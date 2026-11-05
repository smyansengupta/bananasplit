import type { Prisma } from "@/generated/prisma/client";
import {
  ALUMNI_KEEP_IN_TOUCH_DAYS,
  pipelinesFor,
  relationshipTypesFor,
  setupKindsFor,
  viewsFor,
  type SetupKind,
} from "@/lib/crm/templates";
import { planOwners, type OwnerMode } from "@/lib/crm/setup-owners";
import { enqueueJob } from "@/server/jobs/enqueue";

import { CrmError, requireCrm, type CrmActor } from "./access";
import { ensureCrmDatabases } from "./databases";
import { createPipelineFrom } from "./pipelines";
import { moveSponsorsIn, type SponsorsMoveResult } from "./sponsors";
import { saveOrgRouting } from "./outreach/intake";
import { ensurePipelineViews, ensureStarterReports } from "./starter";

/**
 * The CRM's one-step setup (docs/features/crm.md, "Organization setup in one
 * step"). "What do you mostly reach out to?" makes, in one transaction:
 * CrmSettings with the relationship types those answers use, People and
 * Companies in Databases, a ready-made pipeline per answer (each one a
 * database too), the saved views, and, when Finance has deals' partners,
 * the Deals pipeline with every partner and deal moved in. Run
 * again with more answers, it adds what's missing and changes nothing else.
 * Owners and admins only (RLS: CrmSettings is theirs to create). A
 * Personal space is offered its own few answers (PERSONAL_SETUP_KINDS) and
 * gets no Member relationship type.
 */

export interface SetupResult {
  pipelines: number;
  sponsors: SponsorsMoveResult | null;
}

export async function runSetup(actor: CrmActor, kindsInput: readonly string[]): Promise<SetupResult> {
  const access = await requireCrm(actor);
  if (!access.admin) throw new CrmError("Ask an owner or admin to set up the CRM.");
  const { db, organizationId, userId } = actor;
  const picked = setupKindsFor(access.personal).filter((k) => kindsInput.includes(k));
  const hasSponsors = (await db.sponsor.count({ where: { organizationId } })) > 0;
  // Finance's partners and deals come along whether or not they were picked.
  const kinds: SetupKind[] = hasSponsors && !picked.includes("sponsors") ? [...picked, "sponsors"] : picked;
  if (kinds.length === 0) throw new CrmError("Pick at least one.");

  const existing = access.settings;
  const types = relationshipTypesFor(
    [...new Set([...(existing?.setupKinds ?? []), ...kinds])] as SetupKind[],
    { personal: access.personal },
  );
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

  // Each pipeline's saved views, and the ready-made reports (Deals, People, Outreach).
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

/** At most this many people are shared out at setup; the rest keep whoever brought them in. */
const SHARE_OUT_MAX = 5000;

/**
 * First-time setup, step 2: who looks after the people setup just brought
 * in (made since `since`, by the person running it or nobody). Split
 * evenly, by relationship, or nobody yet; the same choice becomes the
 * routing for people who come in later. Owners and admins; a Personal
 * space has one person, so nothing changes there.
 */
export async function shareOutOwners(
  actor: CrmActor,
  mode: OwnerMode,
  since: Date,
): Promise<{ shared: number }> {
  const access = await requireCrm(actor);
  if (!access.admin) throw new CrmError("Ask an owner or admin to set up the CRM.");
  if (access.personal) return { shared: 0 };
  if (mode !== "split" && mode !== "rel" && mode !== "none") throw new CrmError("Pick who looks after them.");
  const { db, organizationId, userId } = actor;
  // People you brought in are yours only for the last two hours: anything older you
  // may have made by hand, and it stays yours. Anyone with no owner is fair game
  // since the CRM began, because "Get your CRM started" can be days after bringing them in.
  const floor = new Date(Date.now() - 2 * 3_600_000);
  const from = Number.isFinite(since.getTime()) && since > floor ? since : floor;
  const begun = access.settings?.setupDoneAt ?? from;
  const people = await db.crmPerson.findMany({
    where: {
      organizationId,
      deletedAt: null,
      OR: [
        { ownerId: userId, createdAt: { gte: from } },
        { ownerId: null, createdAt: { gte: begun < from ? begun : from } },
      ],
    },
    select: { id: true, relationship: true, userId: true },
    take: SHARE_OUT_MAX,
  });
  const members = (await db.membership.findMany({ where: { organizationId }, select: { userId: true }, take: 2000 })).map(
    (m) => m.userId,
  );
  // A member brought in as a person looks after themselves.
  const plan = planOwners(
    mode,
    people.map((p) => ({ id: p.id, relationship: p.relationship, knows: p.userId })),
    members,
  );
  const byOwner = new Map<string | null, string[]>();
  for (const [id, owner] of plan.assign) byOwner.set(owner, [...(byOwner.get(owner) ?? []), id]);
  for (const [owner, ids] of byOwner) {
    for (let i = 0; i < ids.length; i += 500) {
      await db.crmPerson.updateMany({
        where: { organizationId, id: { in: ids.slice(i, i + 500) } },
        data: { ownerId: owner },
      });
    }
  }
  if (plan.routing.mode !== "off" || mode === "none") await saveOrgRouting(actor, access, plan.routing);
  return { shared: people.length };
}
