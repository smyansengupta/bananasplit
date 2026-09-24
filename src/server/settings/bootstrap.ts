import { z } from "zod";

import { OrgChartSource } from "@/generated/prisma/client";
import { requirePermission } from "@/lib/auth/permissions";
import { writeOrgAuditLog } from "@/server/audit";
import { applyCbcTemplate, CBC_PEOPLE, type CbcPersonKey } from "@/server/bootstrap/cbc-template";
import { tags } from "@/server/cache/tags";
import { invalidate } from "@/server/cache/invalidate";
import type { OrgContext } from "@/server/db/context";

/**
 * "Bootstrap CBC workspace" (Settings > Danger zone), OWNER-only: applies the
 * shared Claude Builders Club template (src/server/bootstrap/cbc-template.ts)
 * to this org inside the OWNER's own transaction, so RLS applies: task
 * defaults, the 'Needs President' and 'Design' labels, the Design Requests
 * intake project, a new published org chart version (9 positions), member
 * titles and the CBC theme. It creates no Membership rows.
 *
 * The OWNER confirms which member is which CBC person; the page pre-fills
 * the choice by name.
 */

export interface MemberForMatch {
  userId: string;
  name: string | null;
}

function norm(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .trim()
    .toLowerCase();
}

/** CBC person -> member, by full name, then by a unique first name. */
export function suggestCbcMapping(
  members: readonly MemberForMatch[],
): Partial<Record<CbcPersonKey, string>> {
  const out: Partial<Record<CbcPersonKey, string>> = {};
  const used = new Set<string>();
  for (const person of CBC_PEOPLE) {
    const full = members.find((m) => !used.has(m.userId) && norm(m.name) === norm(person.name));
    if (full) {
      out[person.key] = full.userId;
      used.add(full.userId);
    }
  }
  for (const person of CBC_PEOPLE) {
    if (out[person.key]) continue;
    const first = norm(person.name).split(" ")[0];
    const candidates = members.filter(
      (m) => !used.has(m.userId) && norm(m.name).split(" ")[0] === first,
    );
    if (candidates.length === 1) {
      out[person.key] = candidates[0].userId;
      used.add(candidates[0].userId);
    }
  }
  return out;
}

const mappingSchema = z.record(z.string(), z.string().max(100));

export async function bootstrapCbcWorkspace(
  ctx: OrgContext,
  rawMapping: Record<string, string>,
): Promise<{ error?: string; chartVersionId?: string }> {
  requirePermission(ctx, "workspace.bootstrap");
  const parsed = mappingSchema.safeParse(rawMapping);
  if (!parsed.success) return { error: "Invalid member mapping." };

  const keys = new Set<string>(CBC_PEOPLE.map((p) => p.key));
  const chosen = Object.entries(parsed.data).filter(([key, userId]) => keys.has(key) && userId);
  const userIds = chosen.map(([, userId]) => userId);
  if (new Set(userIds).size !== userIds.length) {
    return { error: "Each member can be matched to one person only." };
  }
  const members = await ctx.db.membership.findMany({
    where: { organizationId: ctx.organizationId, userId: { in: userIds } },
    select: { userId: true },
  });
  if (members.length !== userIds.length) return { error: "Choose current members only." };

  const result = await applyCbcTemplate(ctx.db, {
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    members: Object.fromEntries(chosen) as Partial<Record<CbcPersonKey, string>>,
    source: OrgChartSource.MANUAL,
    setTitles: true,
  });
  await writeOrgAuditLog(ctx.db, {
    organizationId: ctx.organizationId,
    action: "workspace.bootstrapped",
    targetType: "OrgChartVersion",
    targetId: result.chartVersionId,
    diff: { template: "cbc", matched: chosen.length },
  });
  invalidate([
    tags.orgChart(ctx.organizationId),
    tags.theme(ctx.organizationId),
    tags.members(ctx.organizationId),
  ]);
  return { chartVersionId: result.chartVersionId };
}
