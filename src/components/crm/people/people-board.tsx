"use client";

import { DealBoard } from "@/components/crm/lazy-parts";
import type { BoardCard, StageView } from "@/components/crm/pipeline-view";
import { EmptyState } from "@/components/empty-state";
import type { EditField } from "@/lib/crm/record-form";

import { PeopleHeading } from "./people-table";

/**
 * People's Board view (?view=board; docs/features/crm.md, "One list"):
 * "{list} {count} $X in open deals" over one pipeline's deals by stage.
 * Drag a card to move it; a card opens the deal's card over the page.
 */
export function PeopleBoardView({
  orgId,
  heading,
  total,
  money,
  filtered,
  board,
}: {
  orgId: string;
  heading: string;
  total: number;
  money: { text: string; label: string } | null;
  filtered: boolean;
  board: {
    pipeline: { hasAmount: boolean; wonLabel: string; lostLabel: string };
    stages: StageView[];
    cards: BoardCard[];
    stageFields: EditField[];
  } | null;
}) {
  if (!board) {
    return <EmptyState title="No pipelines yet" description="Add one in CRM settings, under Deal stages and types." />;
  }
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PeopleHeading name={heading} total={total} money={money} />
      {board.cards.length === 0 && filtered ? (
        <EmptyState title="No deals match" description="Try another filter, or clear the search." />
      ) : (
        <DealBoard
          orgId={orgId}
          pipeline={board.pipeline}
          stages={board.stages}
          cards={board.cards}
          stageFields={board.stageFields}
        />
      )}
    </div>
  );
}
