import { Fragment, type ReactNode } from "react";

import type { CrmShell } from "@/app/app/[orgSlug]/crm/shell";
import { periodOf } from "@/lib/crm/forecast";
import {
  formatOpen,
  OPEN_PARAM,
  opensInstantly,
  parseOpen,
  type CrmOpen,
  type CrmOpenKind,
} from "@/lib/crm/overlay";
import { effectiveTimezone, localDateKey } from "@/lib/tasks/dates";
import { getOrgMembersForPicker } from "@/server/members";

import { CompanyOverlay } from "./company";
import { CrmCreateHost, type CrmCreateData } from "./create-host";
import { DealOverlay } from "./deal";
import { GoalOverlay } from "./goal";
import { AskOverlay } from "./ask";
import { CallsOverlay } from "./calls";
import { LogOverlay } from "./log";
import { MergeOverlay } from "./merge";
import { PlanOverlay } from "./plan";
import { PersonOverlay } from "./person";
import { PowerOverlay } from "./power";
import { QuoteOverlay } from "./quote";
import { TextOverlay } from "./text";

/**
 * What's open over a CRM page (?open=, src/lib/crm/overlay.ts), loaded on
 * the server and drawn as a CrmCard. Every CRM tab page renders this once,
 * after its own content, with its searchParams:
 *
 *   <CrmOverlays shell={shell} orgSlug={orgSlug} searchParams={sp} />
 *
 * To add a kind of card: write a server component that takes OverlayProps
 * (it loads its data in its own transaction and returns a client card built
 * on CrmCard), then put it in CRM_CARDS below under its `open` kind. A kind
 * with no entry opens nothing. The card is keyed by its `open` value, so
 * switching from one person to another starts the card fresh.
 *
 * The create dialogs (New person, company and deal, a new goal) aren't here:
 * what they need comes with every page, for CrmCreateHost, so `?open=` for
 * one opens it at once with no trip to the server.
 */

export interface OverlayProps<K extends CrmOpenKind = CrmOpenKind> {
  shell: CrmShell;
  orgSlug: string;
  open: Extract<CrmOpen, { kind: K }>;
  searchParams: Record<string, string | string[] | undefined>;
}

type OverlayLoader<K extends CrmOpenKind> = (
  props: OverlayProps<K>,
) => Promise<ReactNode> | ReactNode;

/** One entry per kind of card. */
export const CRM_CARDS: { [K in CrmOpenKind]?: OverlayLoader<K> } = {
  person: PersonOverlay,
  company: CompanyOverlay,
  deal: DealOverlay,
  power: PowerOverlay,
  log: LogOverlay,
  merge: MergeOverlay,
  goal: GoalOverlay,
  plan: PlanOverlay,
  ask: AskOverlay,
  quote: QuoteOverlay,
  calls: CallsOverlay,
  text: TextOverlay,
};

/** What the create dialogs open from: small, and the same for every page. */
async function createData(shell: CrmShell): Promise<CrmCreateData> {
  const today = localDateKey(new Date(), effectiveTimezone(null, shell.org));
  return {
    orgId: shell.org.id,
    viewerId: shell.user.id,
    personal: shell.access.personal,
    canSetGoals: shell.access.manager,
    // Owner is New task's picker (faces, names, titles); a Personal space doesn't ask.
    members: shell.access.personal ? [] : await getOrgMembersForPicker(shell.org.id),
    pipelines: shell.pipelines.map((p) => ({
      id: p.id,
      name: p.name,
      stages: p.stages.filter((s) => s.kind !== "LOST").map((s) => ({ id: s.id, name: s.name })),
    })),
    relationships: (shell.access.settings?.relationshipTypes ?? []).map((t) => ({
      id: t.id,
      label: t.label,
    })),
    goal: {
      metric: shell.pipelines.some((p) => p.hasAmount) ? "amount_won" : "items_won",
      periodKey: periodOf("quarter", today).key,
      today,
    },
  };
}

export async function CrmOverlays({
  shell,
  orgSlug,
  searchParams,
}: {
  shell: CrmShell;
  orgSlug: string;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const open = parseOpen(searchParams[OPEN_PARAM]);
  const load =
    open && !opensInstantly(open)
      ? (CRM_CARDS[open.kind] as OverlayLoader<typeof open.kind> | undefined)
      : undefined;
  const [create, card] = await Promise.all([
    createData(shell),
    load
      ? load({ shell, orgSlug, open, searchParams } as OverlayProps<NonNullable<typeof open>["kind"]>)
      : null,
  ]);
  return (
    <>
      <CrmCreateHost data={create} />
      {open && card ? <Fragment key={formatOpen(open)}>{card}</Fragment> : null}
    </>
  );
}
