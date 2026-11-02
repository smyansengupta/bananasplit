"use client";

import Link from "next/link";

import { NudgeButton } from "@/components/tasks/overdue-actions";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/user-avatar";
import type { WaitingOnOthers as OthersData } from "@/lib/overview/waiting-on-others-text";

import { Insight, LinkChips } from "./connections";

/**
 * Waiting on others: what you asked people for and haven't got yet, with
 * how long it's been and whether they've moved on it. Nudge leaves a
 * comment on the task that mentions them, so they hear about it the way
 * any mention reaches them (in the Inbox, and by email if they chose it)
 * and the nudge stays on the task for everyone to see. Data from
 * loadWaitingOnOthers.
 */

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
                <NudgeButton orgId={orgId} taskId={row.taskId} person={row.person} />
              </span>
            )}
          </li>
        ))}
      </ul>
      {data.insight && <Insight tone={data.insight.tone}>{data.insight.text}</Insight>}
    </div>
  );
}
