import { createHash } from "node:crypto";

import { unstable_cache } from "next/cache";
import { z } from "zod";

import { mergeIssueGroups } from "@/lib/crm/report-classics";
import type { CrmListPayload, IssueGroup } from "@/lib/reports/crm-widgets";
import type { ComputedWidget } from "@/lib/reports/compute";

import { crmCredentials, dataRule, fenced, runCrmAi } from "./ai";
import { topIssuesPayload } from "./report-classics";

/**
 * Top issues grouped by meaning (docs/features/crm.md, "Reports"): the
 * widget groups people's biggest issues by exact text inside the viewer's
 * transaction; the report page then asks the organization's AI, outside
 * it, which of those mean the same thing ("Budget is tight" and "Not
 * enough money"). Only with a model key of the organization's own (or
 * Bananasplit AI); the stand-in and any failure keep the exact groups. The
 * answer is cached a day per set of issues, so a report read again costs
 * nothing.
 */

const groupsSchema = z.object({
  groups: z
    .array(
      z.object({
        label: z.string().max(80),
        members: z.array(z.number().int().min(0)).max(200),
      }),
    )
    .max(40),
  notes: z.string().max(300).nullable(),
});

type Merge = { label: string; members: number[] }[];

/** How long the page waits for the AI before drawing the exact groups. */
const WAIT_MS = 8_000;

async function askAi(organizationId: string, userId: string, labels: string[]): Promise<Merge | null> {
  const creds = await crmCredentials(organizationId);
  if (!creds || creds.protocol === "standin") return null;
  const list = labels.map((l, i) => `${i}. ${fenced(l, "issues")}`).join("\n");
  const result = await runCrmAi({
    organizationId,
    userId,
    feature: "crm.issues",
    creds,
    request: {
      system: `${dataRule("<issues>")}\n\nYou group the biggest issues an organization's contacts have, so the organization sees which ones are most common. Put issues that mean the same thing in one group, named in a few plain words (under 60 characters, sentence case, no period). Leave an issue on its own when nothing else means the same.`,
      text: `<issues>\n${list}\n</issues>\n\nGroup these issues by meaning. Each group lists its issues by their number in \`members\`. Every number at most once.`,
      schema: groupsSchema,
      name: "issue_groups",
      standin: () => ({ groups: [], notes: null }),
    },
  });
  return result.data.groups.map((g) => ({ label: g.label, members: g.members }));
}

/** The AI's grouping for these issues, cached a day per organization and set of issues. */
async function cachedMerge(organizationId: string, userId: string, labels: string[]): Promise<Merge | null> {
  const key = createHash("sha256").update(labels.join("\n")).digest("hex").slice(0, 32);
  const load = () => askAi(organizationId, userId, labels);
  try {
    return await unstable_cache(load, ["crm-issue-groups", organizationId, key], { revalidate: 86_400 })();
  } catch (error) {
    // Outside a Next.js request (scripts, tests) there is no incremental cache.
    if (error instanceof Error && /incrementalCache missing|static generation store missing/i.test(error.message)) {
      return load();
    }
    throw error;
  }
}

/** Exact groups merged by meaning, or null to keep them as they are. */
export async function groupIssuesByMeaning(
  organizationId: string,
  userId: string,
  exact: readonly IssueGroup[],
): Promise<IssueGroup[] | null> {
  if (exact.length < 2) return null;
  const labels = exact.map((g) => g.label);
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), WAIT_MS));
  const merged = await Promise.race([cachedMerge(organizationId, userId, labels).catch(() => null), timeout]);
  return merged ? mergeIssueGroups(exact, merged) : null;
}

/**
 * The report page's last step for Top issues: grouped by meaning when the
 * AI can, and the full list of issues taken off before anything is drawn.
 * Runs outside the transaction.
 */
export async function refineTopIssues(
  organizationId: string,
  slug: string,
  userId: string,
  computed: ComputedWidget[],
): Promise<void> {
  for (const c of computed) {
    if (c.payload?.type !== "crm-top-issues") continue;
    const data: CrmListPayload = c.payload.data;
    const exact = data.issues;
    if (!exact) continue;
    const merged = await groupIssuesByMeaning(organizationId, userId, exact);
    const next = topIssuesPayload(slug, merged ?? exact, false);
    c.payload = { type: "crm-top-issues", data: next };
    // Insights' line about it says what the widget now shows.
    if (!merged || !next.line) continue;
    for (const i of computed) {
      if (i.payload?.type !== "insights" || i.payload.data.byClaude) continue;
      i.payload.data.lines = i.payload.data.lines.map((l) =>
        l.widgetId === c.widget.id ? { ...l, text: next.line!.text, bold: next.line!.bold ?? null } : l,
      );
    }
  }
}
