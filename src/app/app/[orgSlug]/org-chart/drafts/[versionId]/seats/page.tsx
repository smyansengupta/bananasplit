import type { Metadata } from "next";

import { SeatsScreen } from "@/components/org-chart/quick/seats-screen";
import { planGate } from "@/server/billing/plan-gate";

import { loadQuickDraft } from "../quick-data";

export const metadata: Metadata = { title: "Fill the seats" };

/** "Start from a shape": the shape's seats to fill in, and Publish. */
export default async function SeatsDraftPage({
  params,
}: {
  params: Promise<{ orgSlug: string; versionId: string }>;
}) {
  const { orgSlug, versionId } = await params;
  const planLock = await planGate(orgSlug, "people");
  if (planLock) return planLock;
  const data = await loadQuickDraft(orgSlug, versionId, "seats");
  return (
    <SeatsScreen
      key={data.version.editVersion}
      orgId={data.organization.id}
      orgSlug={orgSlug}
      version={data.version}
      positions={data.positions}
      members={data.members}
      canSetTitles={data.canSetTitles}
    />
  );
}
