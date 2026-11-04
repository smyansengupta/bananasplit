import { Fragment, type ReactNode } from "react";

import type { CrmShell } from "@/app/app/[orgSlug]/crm/shell";
import {
  formatOpen,
  OPEN_PARAM,
  parseOpen,
  type CrmOpen,
  type CrmOpenKind,
} from "@/lib/crm/overlay";

import { CompanyOverlay } from "./company";
import { DealOverlay } from "./deal";
import { GoalOverlay } from "./goal";
import { AskOverlay } from "./ask";
import { CallsOverlay } from "./calls";
import { LogOverlay } from "./log";
import { MergeOverlay } from "./merge";
import { NewOverlay } from "./new";
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
  new: NewOverlay,
  merge: MergeOverlay,
  goal: GoalOverlay,
  plan: PlanOverlay,
  ask: AskOverlay,
  quote: QuoteOverlay,
  calls: CallsOverlay,
  text: TextOverlay,
};

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
  if (!open) return null;
  const load = CRM_CARDS[open.kind] as OverlayLoader<typeof open.kind> | undefined;
  if (!load) return null;
  const card = await load({ shell, orgSlug, open, searchParams } as OverlayProps<typeof open.kind>);
  return <Fragment key={formatOpen(open)}>{card}</Fragment>;
}
