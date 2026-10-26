"use client";

import { ArrowLeftRight } from "@/components/icons";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import type { DraftPosition } from "@/lib/org-chart/draft";

import type { EditorMember } from "./member-picker";

/**
 * Titles both ways (Moonstone 12.3): when a linked position's title and
 * the member's title (Settings > Members) differ, offer to update the
 * member's title from the position, or the position from the member's
 * title. Nothing changes until someone presses one of the two.
 */

export interface TitleMismatch {
  position: DraftPosition;
  member: EditorMember;
}

/** Each linked member's first position whose title differs from their member title. */
export function titleMismatches(positions: readonly DraftPosition[], members: readonly EditorMember[]): TitleMismatch[] {
  const byId = new Map(members.map((m) => [m.id, m]));
  const seen = new Set<string>();
  const out: TitleMismatch[] = [];
  for (const p of positions) {
    if (!p.userId || p.matchState !== "CONFIRMED" || p.isOpen || seen.has(p.userId)) continue;
    const member = byId.get(p.userId);
    if (!member) continue;
    seen.add(p.userId);
    const title = p.title.trim();
    if (title && title !== (member.title ?? "").trim()) out.push({ position: p, member });
  }
  return out;
}

export function TitleSync({
  positions,
  members,
  canSetTitles,
  onUseMemberTitle,
  onSetMemberTitle,
}: {
  positions: DraftPosition[];
  members: EditorMember[];
  canSetTitles: boolean;
  onUseMemberTitle: (positionId: string, title: string) => void;
  onSetMemberTitle: (userId: string, title: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const list = titleMismatches(positions, members);
  if (list.length === 0) return null;
  return (
    <section aria-labelledby="title-sync" className="bg-card edge rounded-card flex flex-col gap-3 p-[18px] sm:p-6">
      <div className="flex items-center gap-2">
        <ArrowLeftRight className="text-muted-foreground size-4" aria-hidden="true" />
        <h2 id="title-sync" className="heading text-[15px]">
          Titles to sync
        </h2>
        <Badge variant="secondary">{list.length}</Badge>
      </div>
      <p className="text-muted-foreground text-sm">
        These positions and the members&apos; titles in Settings &gt; Members don&apos;t match. Keep either one.
      </p>
      <ul className="divide-border/70 flex flex-col divide-y">
        {list.map(({ position, member }) => (
          <li key={position.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 text-sm">
            <UserAvatar user={member} size="md" />
            <span className="min-w-0 flex-1">
              <b className="font-semibold">{member.name}</b>
              <span className="text-muted-foreground block truncate">
                Chart: {position.title} · Member title: {member.title?.trim() || "none"}
              </span>
            </span>
            {canSetTitles && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy === member.id}
                onClick={async () => {
                  setBusy(member.id);
                  try {
                    await onSetMemberTitle(member.id, position.title.trim());
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                Update member title
              </Button>
            )}
            {member.title?.trim() && (
              <Button type="button" size="sm" variant="ghost" onClick={() => onUseMemberTitle(position.id, member.title!.trim())}>
                Use &ldquo;{member.title.trim()}&rdquo;
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
