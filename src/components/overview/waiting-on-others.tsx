"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { addTaskComment } from "@/app/app/[orgSlug]/tasks/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { UserAvatar } from "@/components/user-avatar";
import type {
  OthersRow,
  WaitingOnOthers as OthersData,
} from "@/lib/overview/waiting-on-others-text";
import { runAction } from "@/lib/run-action";
import { mentionToken } from "@/lib/tasks/mentions";

import { Insight, LinkChips } from "./connections";

/**
 * Waiting on others: what you asked people for and haven't got yet, with
 * how long it's been and whether they've moved on it. Nudge leaves a
 * comment on the task that mentions them, so they hear about it the way
 * any mention reaches them (in the Inbox, and by email if they chose it)
 * and the nudge stays on the task for everyone to see. Data from
 * loadWaitingOnOthers.
 */

const NUDGE_TEXT = "Checking in on this. Any update?";

export function WaitingOnOthers({ orgId, data }: { orgId: string; data: OthersData }) {
  if (data.rows.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Nothing outstanding. Nobody owes you an answer.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      <ul className="divide-border divide-y">
        {data.rows.map((row) => (
          <li key={row.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
            <UserAvatar user={row.person} size="sm" className="size-7" />
            <span className="min-w-0 flex-1 basis-48">
              <Link
                href={row.href}
                className="block text-[14.5px] leading-snug font-medium break-words hover:underline"
              >
                {row.title}
              </Link>
              <span className="text-muted-foreground mt-0.5 block text-[13px] break-words">
                {row.sub}
              </span>
              <LinkChips items={row.chips} className="mt-1.5" />
            </span>
            {row.state === "on-track" ? (
              <Badge variant="success" className="ml-auto">
                On track
              </Badge>
            ) : (
              <span className="ml-auto flex shrink-0 items-center gap-2">
                {row.state === "overdue" && <Badge variant="destructive">Overdue</Badge>}
                <NudgeButton orgId={orgId} row={row} />
              </span>
            )}
          </li>
        ))}
      </ul>
      {data.insight && <Insight tone={data.insight.tone}>{data.insight.text}</Insight>}
    </div>
  );
}

function NudgeButton({ orgId, row }: { orgId: string; row: OthersRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(NUDGE_TEXT);
  const [pending, start] = useTransition();
  const who = row.person.name?.trim().split(/\s+/)[0] ?? "them";
  const send = () => {
    const body = text.trim();
    if (!body || pending) return;
    start(async () => {
      const result = await runAction(() =>
        addTaskComment(
          orgId,
          row.taskId,
          `${mentionToken(row.person.name ?? "member", row.person.id)} ${body}`,
        ),
      );
      if (result === undefined) return;
      if (result && "error" in result && result.error) {
        toast({ title: result.error, tone: "error" });
        return;
      }
      setOpen(false);
      toast({ title: `Nudged ${who}` });
      router.refresh();
    });
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label={`Nudge ${who}`}>
          Nudge
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <form
          className="space-y-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <p className="text-muted-foreground text-[13px]">
            Comments on the task and mentions {who}.
          </p>
          <Textarea
            autoFocus
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label={`Message to ${who}`}
          />
          <Button type="submit" size="sm" className="w-full" disabled={!text.trim() || pending}>
            Send
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
