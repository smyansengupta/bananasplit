"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState, useTransition } from "react";

import { rsvpToEvent } from "@/app/app/[orgSlug]/calendar/actions";
import { approveExpense, rejectExpense } from "@/app/app/[orgSlug]/finance/transactions-actions";
import { addTaskComment } from "@/app/app/[orgSlug]/tasks/actions";
import { DeclineButton, ReplyBox } from "@/components/inbox/row-actions";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { UserAvatar } from "@/components/user-avatar";
import { runAction } from "@/lib/run-action";
import type {
  WaitingOnYou as WaitingData,
  WaitingRow,
} from "@/server/overview/waiting-on-you-text";

import { Insight, LinkChips } from "./connections";

/**
 * Waiting on you: the Inbox's needs-you items on Home, each with the thing
 * to do right on the row (Approve and Decline a reimbursement, Review a
 * form's responses, Reply to a mention, answer an invite), what it
 * unblocks under its title, and for finance what approving does to the
 * budget. A row you act on leaves at once, focus moving to the next row
 * (or the card's heading when none is left); the page refreshes behind it.
 * Data from loadWaitingOnYou.
 */

type Result = { error?: string | null } | null | undefined | void;

function errorOf(result: unknown): string | null {
  if (result && typeof result === "object" && "error" in result) {
    const e = (result as { error?: unknown }).error;
    return typeof e === "string" && e ? e : null;
  }
  return null;
}

export function WaitingOnYou({ orgId, data }: { orgId: string; data: WaitingData }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [replying, setReplying] = useState<string | null>(null);
  const root = useRef<HTMLElement | null>(null);
  const setRoot = (el: HTMLElement | null) => {
    root.current = el;
  };
  const links = useRef(new Map<string, HTMLAnchorElement>());
  /** Where focus goes once a hidden row is gone: a row's key, or "heading". */
  const focusNext = useRef<string | null>(null);

  const rows = data.rows.filter((r) => !gone.has(r.key));

  const hide = (key: string) => {
    const i = rows.findIndex((r) => r.key === key);
    const next = rows[i + 1] ?? rows[i - 1];
    focusNext.current = next ? next.key : "heading";
    setGone((s) => new Set(s).add(key));
  };

  useEffect(() => {
    const to = focusNext.current;
    if (!to) return;
    focusNext.current = null;
    const link = links.current.get(to);
    if (link) {
      link.focus();
      return;
    }
    // The widget's card heading (the board draws it in the section around us).
    const heading = root.current?.closest("section")?.querySelector<HTMLElement>("h2");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus();
    }
  }, [gone]);

  const show = (key: string) =>
    setGone((s) => {
      const next = new Set(s);
      next.delete(key);
      return next;
    });

  /** Runs an inline action: the row goes now, and comes back if it fails. */
  const act = (row: WaitingRow, run: () => Promise<Result>, done: string) => {
    hide(row.key);
    start(async () => {
      const result = await runAction(async () => ({ value: await run() }));
      if (!result) return show(row.key);
      const error = errorOf(result.value);
      if (error) {
        show(row.key);
        toast({ title: error, tone: "error" });
        return;
      }
      toast({ title: done });
      router.refresh();
    });
  };

  if (rows.length === 0) {
    return (
      <p ref={setRoot} className="text-muted-foreground py-2 text-[14px]">
        Nobody is waiting on you.
      </p>
    );
  }

  return (
    <div ref={setRoot} className="space-y-4">
      {data.insight && rows.some((r) => r.kind === "request") && (
        <Insight tone={data.insight.tone}>
          {data.insight.runs.map((run, i) =>
            run.bold ? <b key={i}>{run.text}</b> : <Fragment key={i}>{run.text}</Fragment>,
          )}
        </Insight>
      )}

      <ul className="divide-border divide-y">
        {rows.map((row) => (
          <li key={row.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
            {row.face ? (
              <UserAvatar user={row.face} size="sm" className="size-7" />
            ) : (
              <span
                aria-hidden="true"
                className="bg-tint-success text-tint-success-foreground grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-bold"
              >
                {row.count}
              </span>
            )}
            <span className="min-w-0 flex-1">
              <Link
                ref={(el) => {
                  if (el) links.current.set(row.key, el);
                  else links.current.delete(row.key);
                }}
                href={row.href}
                className="block text-[14.5px] leading-snug font-medium break-words hover:underline"
              >
                {row.title}
              </Link>
              {row.sub && (
                <span className="text-muted-foreground mt-0.5 block text-[13px] break-words">
                  {row.sub}
                </span>
              )}
            </span>
            <span className="flex shrink-0 gap-2">
              {row.kind === "request" && (
                <>
                  <DeclineButton
                    title={row.title}
                    onDecline={(reason) =>
                      act(row, () => rejectExpense(orgId, row.id, reason), "Declined")
                    }
                  />
                  <Button
                    size="sm"
                    aria-label={`Approve ${row.title}`}
                    onClick={() => act(row, () => approveExpense(orgId, row.id), "Approved")}
                  >
                    Approve
                  </Button>
                </>
              )}
              {row.kind === "review" && (
                <Button asChild variant="outline" size="sm">
                  <Link href={row.href} aria-label={`Review ${row.title}`}>
                    Review
                  </Link>
                </Button>
              )}
              {row.kind === "mention" &&
                (row.replyTaskId ? (
                  <Button
                    variant={replying === row.key ? "secondary" : "outline"}
                    size="sm"
                    aria-expanded={replying === row.key}
                    aria-label={`Reply to ${row.title}`}
                    onClick={() => setReplying(replying === row.key ? null : row.key)}
                  >
                    Reply
                  </Button>
                ) : (
                  <Button asChild variant="outline" size="sm">
                    <Link href={row.href} aria-label={`Reply to ${row.title}`}>
                      Reply
                    </Link>
                  </Button>
                ))}
              {row.kind === "invite" && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Can't go to ${row.title}`}
                    onClick={() =>
                      act(row, () => rsvpToEvent(orgId, row.id, "NO"), "Answered: can't go")
                    }
                  >
                    Can&rsquo;t go
                  </Button>
                  <Button
                    size="sm"
                    aria-label={`Going to ${row.title}`}
                    onClick={() =>
                      act(row, () => rsvpToEvent(orgId, row.id, "YES"), "You're going")
                    }
                  >
                    Going
                  </Button>
                </>
              )}
            </span>
            {replying === row.key && row.replyTaskId && (
              <div className="basis-full pl-10">
                <ReplyBox
                  onCancel={() => setReplying(null)}
                  onSend={async (body) => {
                    const result = await addTaskComment(orgId, row.replyTaskId!, body);
                    const error = errorOf(result);
                    if (error) {
                      toast({ title: error, tone: "error" });
                      return false;
                    }
                    setReplying(null);
                    hide(row.key);
                    toast({ title: "Replied" });
                    router.refresh();
                    return true;
                  }}
                />
              </div>
            )}
          </li>
        ))}
      </ul>

      <LinkChips items={data.chips} />
    </div>
  );
}
