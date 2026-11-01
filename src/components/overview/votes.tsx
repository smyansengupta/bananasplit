import { Check, Vote } from "@/components/icons";
import Link from "next/link";
import type { CSSProperties } from "react";

import { Button } from "@/components/ui/button";
import { tagToken } from "@/lib/tag-colors";
import type { VoteCard, Votes as VotesData } from "@/lib/overview/votes-text";

import { Insight } from "./connections";

/**
 * Votes (one column): open elections and polls, each a card with how many
 * have voted (out of how many, where that's known), who's ahead where the
 * results are open, and whether you've voted, with Vote when you haven't.
 * Data from loadVotes.
 */

const KIND = {
  election: { word: "Election", color: "plum" },
  poll: { word: "Poll", color: "navy" },
} as const;

function Turnout({ card }: { card: VoteCard }) {
  if (card.voters === null) return null;
  if (card.eligible === null || card.percent === null) {
    return (
      <p className="text-[13px] font-semibold">
        {card.voters} {card.voters === 1 ? "vote" : "votes"} so far
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      <p className="flex items-baseline justify-between gap-2 text-[13px] font-semibold tabular-nums">
        <span>
          {card.voters} of {card.eligible} voted
        </span>
        <span>{card.percent}%</span>
      </p>
      <span
        role="img"
        aria-label={`${card.voters} of ${card.eligible} voted`}
        className="bg-muted-strong block h-1.5 overflow-hidden rounded-full"
      >
        <span
          className="block h-full rounded-full bg-(--k) transition-[width] duration-700"
          style={{ width: `${Math.max(card.percent, card.voters > 0 ? 3 : 0)}%` }}
        />
      </span>
    </div>
  );
}

export function Votes({ data }: { data: VotesData }) {
  if (data.cards.length === 0) {
    return <p className="text-muted-foreground text-sm">No elections or polls are open.</p>;
  }
  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {data.cards.map((card) => {
          const kind = KIND[card.kind];
          return (
            <li
              key={card.key}
              style={{ "--k": `var(${tagToken(kind.color)})` } as CSSProperties}
              className="bg-muted/60 rounded-tile space-y-2.5 p-3.5"
            >
              <p className="flex items-center justify-between gap-2">
                <span className="inline-flex h-6 items-center rounded-full bg-[color-mix(in_oklab,var(--k)_16%,var(--card))] px-2.5 text-xs font-semibold text-[color-mix(in_oklab,var(--k)_75%,var(--foreground))]">
                  {kind.word}
                </span>
                {card.closes && (
                  <span className="text-muted-foreground text-[12.5px]">{card.closes}</span>
                )}
              </p>
              <Link
                href={card.href}
                className="block text-[15px] leading-snug font-semibold hover:underline"
              >
                {card.title}
              </Link>
              <Turnout card={card} />
              {card.leader && <p className="text-[13px]">{card.leader}</p>}
              {card.mine === true && (
                <p className="text-tint-success-foreground inline-flex items-center gap-1 text-[12.5px] font-semibold">
                  <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
                  You voted
                </p>
              )}
              {card.mine === false && (
                <Button asChild size="sm" className="w-full">
                  <Link href={card.href} aria-label={`Vote: ${card.title}`}>
                    Vote
                  </Link>
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {data.insight && <Insight icon={Vote}>{data.insight}</Insight>}
    </div>
  );
}
