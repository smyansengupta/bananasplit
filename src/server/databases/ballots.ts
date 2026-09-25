import type { Prisma } from "@/generated/prisma/client";
import type { TxClient } from "@/server/db/context";

import { classifyBallot, readDefinition, STICKY_REASONS, type ImportedDefinition } from "./ballot-definitions";

/**
 * Ballot writes shared by the admin actions (app_user, OWNER/ADMIN) and the
 * website sync (service path): linking ballots to their definition by slug,
 * re-deciding which ones count, and rewriting their BallotChoice rows through
 * app.explode_ballot.
 */

export interface ReevaluateResult {
  ballots: number;
  excluded: number;
  exploded: number;
}

/**
 * Re-links every ballot of `slugs` (all slugs when null) to its definition,
 * recomputes excludedReason (admin suppression is sticky) and re-explodes
 * the ballots whose definition or answers changed.
 */
export async function reevaluateBallots(
  db: TxClient,
  organizationId: string,
  slugs: readonly string[] | null,
  options: { explode?: "changed" | "all" } = {},
): Promise<ReevaluateResult> {
  const defs = await db.ballotDefinition.findMany({
    where: { organizationId, ...(slugs ? { slug: { in: [...slugs] } } : {}) },
    select: { id: true, slug: true, isTest: true, opensAt: true, closesAt: true, definition: true },
  });
  const bySlug = new Map(defs.map((d) => [d.slug, { ...d, parsed: readDefinition(d.definition) }]));
  const ballots = await db.ballot.findMany({
    where: { organizationId, ...(slugs ? { pollSlug: { in: [...slugs] } } : {}) },
    select: { id: true, pollSlug: true, castAt: true, answers: true, ballotDefinitionId: true, excludedReason: true },
  });
  let excluded = 0;
  let exploded = 0;
  for (const b of ballots) {
    const def = bySlug.get(b.pollSlug) ?? null;
    const sticky = b.excludedReason !== null && STICKY_REASONS.includes(b.excludedReason);
    const reason = sticky
      ? b.excludedReason
      : classifyBallot(
          { pollSlug: b.pollSlug, castAt: b.castAt, answers: b.answers },
          def ? { isTest: def.isTest, opensAt: def.opensAt, closesAt: def.closesAt, definition: def.parsed } : null,
        );
    const defId = def?.id ?? null;
    const changed = defId !== b.ballotDefinitionId || reason !== b.excludedReason;
    if (reason) excluded += 1;
    if (changed) {
      await db.ballot.update({
        where: { id: b.id },
        data: { ballotDefinitionId: defId, excludedReason: reason },
      });
    }
    if (changed || options.explode === "all") {
      await db.$queryRaw`SELECT app.explode_ballot(${organizationId}, ${b.id}) AS n`;
      exploded += 1;
    }
  }
  return { ballots: ballots.length, excluded, exploded };
}

/**
 * Creates or replaces the definition for a slug. With `reevaluate` (the
 * service path, or an owner who can see every ballot) it then re-evaluates
 * that slug's ballots; otherwise the caller runs reevaluateBallots on the
 * service path after its own transaction commits.
 */
export async function upsertBallotDefinition(
  db: TxClient,
  organizationId: string,
  imported: ImportedDefinition,
  extra: { linkedEventId?: string | null; isTest?: boolean } = {},
  options: { reevaluate?: boolean } = { reevaluate: true },
): Promise<{ id: string; created: boolean; result: ReevaluateResult | null }> {
  const existing = await db.ballotDefinition.findFirst({
    where: { organizationId, slug: imported.slug },
    select: { id: true },
  });
  const data = {
    title: imported.title,
    opensAt: imported.opensAt,
    closesAt: imported.closesAt,
    definition: imported.definition as unknown as Prisma.InputJsonValue,
    ...(extra.linkedEventId !== undefined ? { linkedEventId: extra.linkedEventId } : {}),
    ...(extra.isTest !== undefined ? { isTest: extra.isTest } : {}),
  };
  const id = existing
    ? (await db.ballotDefinition.update({ where: { id: existing.id }, data, select: { id: true } })).id
    : (
        await db.ballotDefinition.create({
          data: { organizationId, slug: imported.slug, ...data },
          select: { id: true },
        })
      ).id;
  const result = options.reevaluate
    ? await reevaluateBallots(db, organizationId, [imported.slug], { explode: "all" })
    : null;
  return { id, created: !existing, result };
}
