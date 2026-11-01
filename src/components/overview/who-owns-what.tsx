"use client";

import { Check, UserPlus } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { selfAssignTask, updateTask } from "@/app/app/[orgSlug]/tasks/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toaster";
import { UserAvatar } from "@/components/user-avatar";
import { andList, type Piece, type PieceTone } from "@/lib/overview/ownership";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";
import type { OwnershipSuggestion, WhoOwnsWhatData } from "@/server/overview/who-owns-what";

import { CardControls, OpenLink } from "./bits";
import { Insight, LinkChips } from "./connections";

/**
 * Who owns what (Overview): the next big event's work, piece by piece, and
 * who has each piece (src/server/overview/who-owns-what.ts). A piece nobody
 * owns is an empty seat, with Assign: you, or someone who signed up to help
 * or is going. Two columns on a wide card, one on a phone.
 */

const TONE: Record<PieceTone, "success" | "destructive" | "accent" | "secondary"> = {
  done: "success",
  blocked: "destructive",
  late: "destructive",
  seat: "destructive",
  soon: "accent",
  open: "secondary",
};

const first = (name: string | null) => name?.trim().split(/\s+/)[0] ?? "Someone";

function errorOf(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  if ("error" in result && typeof result.error === "string") return result.error;
  if ("confirm" in result && result.confirm) return "Open the task to confirm this assignment.";
  return null;
}

/** The card header's controls: the event's name, then ↗ to it. */
export function WhoOwnsWhatControls({ data }: { data: WhoOwnsWhatData | null }) {
  return (
    <CardControls
      chips={
        data ? (
          <span className="text-muted-foreground min-w-0 truncate text-[13px]">
            {data.event.title}
          </span>
        ) : null
      }
    >
      {data && <OpenLink href={data.event.href} label={data.event.title} />}
    </CardControls>
  );
}

export function WhoOwnsWhat({ orgId, data }: { orgId: string; data: WhoOwnsWhatData | null }) {
  if (!data) {
    return (
      <p className="text-muted-foreground text-sm">
        No event in the next three weeks has tasks linked to it. Link some and who owns each piece
        shows here.
      </p>
    );
  }
  const seats = data.pieces.filter((p) => p.owners.length === 0 && p.unownedTaskIds.length > 0);
  const blocked = data.pieces.filter((p) => p.state.tone === "blocked");
  return (
    <div className="space-y-4">
      <Finding data={data} seats={seats} blocked={blocked} />
      <ul className="grid gap-x-6 sm:grid-cols-2">
        {data.pieces.map((piece) => (
          <PieceRow key={piece.key} orgId={orgId} piece={piece} suggestions={data.suggestions} />
        ))}
      </ul>
      <LinkChips items={data.links} />
    </div>
  );
}

function Finding({
  data,
  seats,
  blocked,
}: {
  data: WhoOwnsWhatData;
  seats: readonly Piece[];
  blocked: readonly Piece[];
}) {
  const days = data.event.daysOut;
  const out = days === 0 ? "and it's today" : days === 1 ? "a day out" : `${days} days out`;
  if (seats.length > 0) {
    const claimed = data.suggestions.filter((s) => s.why === "claimed");
    const going = data.suggestions.filter((s) => s.why === "going");
    const names = (list: readonly OwnershipSuggestion[]) =>
      andList(list.map((s) => first(s.face.name)));
    return (
      <Insight tone="warn">
        {seats.map((p, i) => (
          <span key={p.key}>
            {i > 0 && (i === seats.length - 1 ? " and " : ", ")}
            <b>{p.title}</b>
          </span>
        ))}{" "}
        {seats.length === 1 ? "has" : "have"} no owner, {out}.
        {claimed.length > 0 && ` ${names(claimed)} signed up to bring something.`}
        {going.length > 0 && ` ${names(going)} ${going.length === 1 ? "is" : "are"} going.`}
      </Insight>
    );
  }
  if (blocked.length > 0) {
    const piece = blocked[0]!;
    return (
      <Insight tone="warn">
        <b>{piece.title}</b> is blocked{piece.blockedReason ? `: ${piece.blockedReason}` : ""}.
      </Insight>
    );
  }
  if (data.pieces.every((p) => p.state.tone === "done")) {
    return (
      <Insight tone="good" icon={Check}>
        Everything for <b>{data.event.title}</b> is done.
      </Insight>
    );
  }
  return null;
}

function PieceRow({
  orgId,
  piece,
  suggestions,
}: {
  orgId: string;
  piece: Piece;
  suggestions: readonly OwnershipSuggestion[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const seat = piece.owners.length === 0;
  const lead = piece.owners[0];

  const assign = (who: { me: true } | { id: string; name: string | null }) =>
    start(async () => {
      for (const taskId of piece.unownedTaskIds) {
        const result = await runAction(() =>
          "me" in who
            ? selfAssignTask(orgId, taskId, "claim")
            : updateTask(orgId, taskId, { ownerId: who.id }),
        );
        if (result === undefined) return;
        const failed = errorOf(result);
        if (failed) {
          toast({ title: failed, tone: "error" });
          return;
        }
      }
      router.refresh();
      toast({ title: "Assigned", tone: "success" });
    });

  return (
    <li className="border-border/70 flex min-w-0 items-center gap-3 border-b py-3">
      {seat ? (
        <span
          aria-hidden="true"
          className="border-tint-danger-foreground/50 text-tint-danger-foreground grid size-8 shrink-0 place-items-center rounded-full border border-dashed text-xs font-bold"
        >
          ?
        </span>
      ) : (
        <UserAvatar user={lead!} size="md" />
      )}
      <span className="min-w-0 flex-1">
        <Link
          href={piece.href}
          className="block truncate text-[15px] font-semibold hover:underline"
        >
          {piece.title}
        </Link>
        <span className="text-muted-foreground block truncate text-[13px]">
          {seat
            ? "Nobody yet"
            : piece.owners.length === 1
              ? (lead!.name ?? "Member")
              : `${lead!.name ?? "Member"} and ${piece.owners.length - 1} more`}
          {piece.unownedTaskIds.length > 0 && !seat && `, ${piece.unownedTaskIds.length} unowned`}
        </span>
      </span>
      {piece.unownedTaskIds.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="xs"
              disabled={pending}
              className={cn(seat && "border-dashed")}
              aria-label={`Assign: ${piece.title}`}
            >
              <UserPlus aria-hidden="true" />
              Assign
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => assign({ me: true })}>Me</DropdownMenuItem>
            {suggestions.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Signed up or going</DropdownMenuLabel>
                {suggestions.map((s) => (
                  <DropdownMenuItem
                    key={s.face.id}
                    onSelect={() => assign({ id: s.face.id, name: s.face.name })}
                  >
                    <UserAvatar user={s.face} size="xs" />
                    {s.face.name ?? "Member"}
                  </DropdownMenuItem>
                ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Badge variant={TONE[piece.state.tone]}>{piece.state.word}</Badge>
      )}
    </li>
  );
}
