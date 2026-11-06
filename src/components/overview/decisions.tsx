"use client";

import { Check, Ellipsis, Plus, UserPlus, X } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { updateEvent } from "@/app/app/[orgSlug]/calendar/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import type { Role } from "@/generated/prisma/enums";
import { can } from "@/lib/auth/permissions";
import {
  decisionAction,
  decisionLine,
  decisionsFinding,
  withAgendaLine,
  type DecisionRow,
} from "@/lib/overview/decisions";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";
import {
  createDecision,
  decide,
  dropDecision,
  linkDecision,
  takeDecision,
  type DecisionResult,
} from "@/server/decisions/actions";
import { canSettle } from "@/server/decisions/rules";
import type { DecisionsData } from "@/server/overview/decisions";

import { CardControls, OpenLink } from "./bits";
import { Insight, LinkChips } from "./connections";

/**
 * Decisions (Overview): the organization's open questions
 * (src/server/overview/decisions.ts). Each row says where it came from (its
 * chips), where it stands ("7 of 12 voted. Closes Mon.", "Raised twice.
 * Nobody owns it."), its poll's standings when it has one, and the one
 * thing it asks of you: Vote, Take it, or Add to agenda when it links a
 * meeting with one coming up. Deciding, dropping and taking it live in the
 * row's menu. Under the list, a line to raise a new one.
 *
 * Each row offers only what the viewer may do (the actions refuse the rest
 * anyway): deciding and dropping by the server's own rule (canSettle), and
 * Add to agenda for those who may edit a meeting (events.write: owners and
 * admins).
 */

type Viewer = { userId: string; role: Role | null };

/** The card header's controls: the count, what the list is, and ↗ to the meetings they go to. */
export function DecisionsControls({ count, href }: { count: number; href: string }) {
  return (
    <CardControls
      count={count || undefined}
      chips={
        <span className="text-muted-foreground truncate text-[13px] max-md:hidden">
          Open, from meetings and polls
        </span>
      }
    >
      <OpenLink href={href} label="Meetings" />
    </CardControls>
  );
}

const SHOWN_OPTIONS = 3;

function failed(result: DecisionResult | { error?: string }): string | null {
  if ("ok" in result) return result.ok ? null : result.error;
  return result.error ?? null;
}

export function Decisions({
  orgId,
  viewer,
  data,
}: {
  orgId: string;
  viewer: Viewer;
  data: DecisionsData;
}) {
  const canAgenda = can(viewer, "events.write");
  const ctx = {
    todayKey: data.todayKey,
    timeZone: data.timeZone,
    viewerId: viewer.userId,
    canAgenda,
  };
  const finding = decisionsFinding(data.rows, ctx);
  return (
    <div className="space-y-3">
      {data.rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">No open questions. Raise one below.</p>
      ) : (
        <ul>
          {data.rows.map((row) => (
            <DecisionItem
              key={row.id}
              orgId={orgId}
              row={row}
              line={decisionLine(row, ctx)}
              settles={canSettle(viewer, {
                ownerId: row.owner?.id ?? null,
                createdById: row.createdById,
              })}
              canAgenda={canAgenda}
            />
          ))}
        </ul>
      )}
      {finding?.kind === "overdue" && (
        <Insight tone="warn">
          {finding.titles.map((t, i) => (
            <span key={t}>
              {i > 0 && (i === finding.titles.length - 1 ? " and " : ", ")}
              <b>{t}</b>
            </span>
          ))}{" "}
          {finding.titles.length === 1 ? "is" : "are"} past{" "}
          {finding.titles.length === 1 ? "its" : "their"} date and still open.
        </Insight>
      )}
      {finding?.kind === "unowned" && (
        <Insight>
          <b>{finding.count} open questions</b> have nobody on them.
        </Insight>
      )}
      <AddQuestion orgId={orgId} />
    </div>
  );
}

function DecisionItem({
  orgId,
  row,
  line,
  settles,
  canAgenda,
}: {
  orgId: string;
  row: DecisionRow;
  line: string;
  /** The viewer may decide or drop it. */
  settles: boolean;
  /** The viewer may edit a meeting's agenda. */
  canAgenda: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [deciding, setDeciding] = useState(false);
  const [outcome, setOutcome] = useState("");
  const action = decisionAction(row, { canAgenda });
  const agendaSlot = canAgenda && row.agenda && !row.agenda.onAgenda ? row.agenda : null;
  const hasMenu = !row.owner || settles || (agendaSlot !== null && action !== "agenda");

  const act = (run: () => Promise<DecisionResult | { error?: string }>, done: string) =>
    start(async () => {
      const result = await runAction(run);
      if (!result) return;
      const error = failed(result);
      if (error) {
        toast({ title: error, tone: "error" });
        return;
      }
      router.refresh();
      toast({ title: done, tone: "success" });
    });

  const take = () => act(() => takeDecision(orgId, row.id), "Yours now");
  const drop = () => act(() => dropDecision(orgId, row.id), "Dropped");
  const settle = () => {
    const text = outcome.trim();
    if (!text) return;
    act(async () => {
      const result = await decide(orgId, row.id, text);
      if (result.ok) setDeciding(false);
      return result;
    }, "Decided");
  };
  const addToAgenda = () => {
    const slot = row.agenda;
    if (!slot) return;
    act(async () => {
      const result = await updateEvent(orgId, slot.eventId, {
        description: withAgendaLine(slot.agenda, row.question),
      });
      if (result.error) return result;
      // So the decision's chips include the meeting it's going to (best effort).
      if (!row.links.some((l) => l.href === slot.href)) {
        await linkDecision(orgId, row.id, { kind: "event", id: slot.eventId });
      }
      return {};
    }, "Added to the agenda");
  };

  const top = row.poll?.options.slice(0, SHOWN_OPTIONS) ?? [];
  return (
    <li className="border-border/70 space-y-2.5 border-b py-3.5 first:pt-0 last:border-b-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold break-words">{row.question}</p>
          {line && <p className="text-muted-foreground mt-0.5 text-[13px]">{line}</p>}
        </div>
        {action === "vote" && row.poll && (
          <Button asChild variant="outline" size="sm">
            <Link href={row.poll.href} aria-label={`Vote: ${row.question}`}>
              Vote
            </Link>
          </Button>
        )}
        {action === "take" && (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={take}
            aria-label={`Take it: ${row.question}`}
          >
            Take it
          </Button>
        )}
        {action === "agenda" && (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={addToAgenda}
            aria-label={`Add to agenda: ${row.question}`}
          >
            Add to agenda
          </Button>
        )}
        {hasMenu && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`More for ${row.question}`}
                disabled={pending}
              >
                <Ellipsis aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {!row.owner && (
                <DropdownMenuItem onSelect={take}>
                  <UserPlus aria-hidden="true" />
                  Take it
                </DropdownMenuItem>
              )}
              {settles && (
                <DropdownMenuItem onSelect={() => setDeciding(true)}>
                  <Check aria-hidden="true" />
                  Mark decided
                </DropdownMenuItem>
              )}
              {agendaSlot && action !== "agenda" && (
                <DropdownMenuItem onSelect={addToAgenda}>
                  <Plus aria-hidden="true" />
                  Add to {agendaSlot.title}&apos;s agenda
                </DropdownMenuItem>
              )}
              {settles && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={drop}>
                    <X aria-hidden="true" />
                    Drop it
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {top.length > 0 && (
        <ul className="space-y-2" aria-label="Where the vote stands">
          {top.map((o, i) => (
            <li key={o.label} className="space-y-1">
              <span
                className={cn(
                  "flex justify-between gap-2 text-[13px]",
                  i === 0 ? "font-bold" : "font-medium",
                )}
              >
                <span className="min-w-0 truncate">{o.label}</span>
                <span className="tabular-nums">{o.pct}%</span>
              </span>
              <span
                aria-hidden="true"
                className="bg-muted block h-1.5 overflow-hidden rounded-full"
              >
                <span
                  className={cn(
                    "block h-full rounded-full",
                    i === 0 ? "bg-foreground" : "bg-foreground/25",
                  )}
                  style={{ width: `${Math.min(100, Math.max(o.pct, o.votes > 0 ? 3 : 0))}%` }}
                />
              </span>
            </li>
          ))}
        </ul>
      )}

      {deciding && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            settle();
          }}
        >
          <Input
            autoFocus
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            placeholder="What was decided?"
            aria-label={`What was decided about ${row.question}`}
            maxLength={500}
            className="h-8"
          />
          <Button type="submit" size="sm" disabled={pending || !outcome.trim()}>
            Save
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setDeciding(false)}>
            Cancel
          </Button>
        </form>
      )}

      {(row.links.length > 0 || row.poll?.mine) && (
        <div className="flex flex-wrap items-center gap-1.5">
          <LinkChips items={row.links} />
          {row.poll?.mine && <Badge variant="success">You voted</Badge>}
        </div>
      )}
    </li>
  );
}

function AddQuestion({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const add = () =>
    start(async () => {
      const question = text.trim();
      if (!question) return;
      const result = await runAction(() => createDecision(orgId, { question }));
      if (!result) return;
      if (!result.ok) {
        toast({ title: result.error, tone: "error" });
        return;
      }
      setText("");
      router.refresh();
      toast({ title: "Added", tone: "success" });
    });
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
    >
      <Plus className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add an open question"
        aria-label="Add an open question"
        maxLength={200}
        disabled={pending}
        className="focus-visible:border-input h-9 border-transparent bg-transparent px-1 shadow-none"
      />
      {text.trim() && (
        <Button type="submit" size="sm" disabled={pending}>
          Add
        </Button>
      )}
    </form>
  );
}
