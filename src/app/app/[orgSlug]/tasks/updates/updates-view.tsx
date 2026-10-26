"use client";

import { formatDistanceToNow } from "date-fns";
import { Check, ChevronLeft, ChevronRight, ClipboardCopy, Lock, Send } from "@/components/icons";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

import { useTasks } from "@/components/tasks/tasks-context";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/user-avatar";
import { addDaysToKey, formatDueKey, WEEKDAY_NAMES } from "@/lib/tasks/dates";
import {
  formatWeeklyText,
  privateItemCount,
  summaryLines,
  type WeeklyItem,
  type WeeklySummary,
} from "@/lib/tasks/weekly-text";
import { cn } from "@/lib/utils";

import { postWeeklyUpdate } from "../actions";

/**
 * The weekly update helper: for one person and one week (the seven days
 * ending on the club's update day, org time), what they finished, what's
 * next and what's blocked, drafted from their tasks. 'Copy as text' for Slack; 'Post update' saves it (with a
 * note) as their WeeklyUpdate. OWNER/ADMIN also see who hasn't posted.
 */

export interface PostedUpdate {
  userId: string;
  postedAt: string | null;
  note: string | null;
  done: string[];
  next: string[];
  blocked: string[];
}

export function UpdatesView({
  personId,
  personName,
  weekStart,
  currentWeekStart,
  summary,
  posted,
  expected,
  weekUpdates,
  canSeeWhoPosted,
  dueDay,
}: {
  personId: string;
  personName: string;
  weekStart: string;
  currentWeekStart: string;
  summary: WeeklySummary;
  posted: PostedUpdate | null;
  expected: { userId: string; name: string | null; title: string | null }[];
  weekUpdates: PostedUpdate[];
  canSeeWhoPosted: boolean;
  /** The club's update day, 0 Sunday … 6 Saturday: the week's last day. */
  dueDay: number;
}) {
  const { org, viewer, members, memberById, announce } = useTasks();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [note, setNote] = useState(posted?.note ?? "");
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();
  const isMe = personId === viewer.userId;
  const lines = summaryLines(summary, org.todayKey);
  // C4: a posted update is readable by the whole org, so private tasks are
  // drafted for the person but never published. Saying so here is the whole
  // point — a silent omission would be worse than either choice.
  const heldBack = privateItemCount(summary);

  function navigate(params: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(params)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    router.push(`${pathname}?${next.toString()}`);
  }

  async function copy() {
    const text = formatWeeklyText({ personName, weekStart, lines, note });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      announce("Couldn't copy. Select the text and copy it yourself.");
    }
  }

  function post() {
    startTransition(async () => {
      const result = await postWeeklyUpdate(org.id, { weekStart, note: note.trim() || null });
      if (result.error) announce(result.error);
      else announce("Update posted.");
    });
  }

  const postedBy = new Map(weekUpdates.filter((u) => u.postedAt).map((u) => [u.userId, u]));
  const notPosted = expected.filter((e) => !postedBy.has(e.userId));
  const isFuture = weekStart > currentWeekStart;
  const lastDay = addDaysToKey(weekStart, 6);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
      <div className="space-y-5">
        <div>
          <h2 className="text-lg font-semibold">Weekly update</h2>
          <p className="text-muted-foreground text-sm">
            Due {formatDueKey(lastDay, org.todayKey)}. What you finished, what&apos;s next and
            what&apos;s stuck, drafted from your tasks: check it, add a note, post.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={personId}
            onValueChange={(v) => navigate({ person: v === viewer.userId ? null : v })}
          >
            <SelectTrigger className="w-56" aria-label="Person">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {members.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name ?? "Member"}
                  {m.id === viewer.userId ? " (you)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              aria-label="Previous week"
              onClick={() => navigate({ week: addDaysToKey(weekStart, -7) })}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="min-w-44 text-center text-sm font-medium">
              {formatDueKey(weekStart, org.todayKey)} – {formatDueKey(lastDay, org.todayKey)}
            </span>
            <Button
              variant="outline"
              size="icon"
              aria-label="Next week"
              disabled={weekStart >= currentWeekStart}
              onClick={() => navigate({ week: addDaysToKey(weekStart, 7) })}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
          {weekStart !== currentWeekStart && (
            <Button variant="ghost" size="sm" onClick={() => navigate({ week: null })}>
              This week
            </Button>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Column title="Done this week" items={summary.done} kind="done" />
          <Column title="What's next" items={summary.next} kind="next" />
          <Column title="Blocked" items={summary.blocked} kind="blocked" />
        </div>

        {heldBack > 0 && (
          <p className="text-muted-foreground flex items-start gap-2 text-sm">
            <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>
              {heldBack === 1 ? "One private task is" : `${heldBack} private tasks are`} in this
              week but will not be posted. A posted update is readable by the whole club, so private
              titles stay out of it — put them in the note yourself if you want to.
            </span>
          </p>
        )}

        {isMe ? (
          <div className="space-y-3 rounded-lg border p-4">
            <div className="grid gap-1.5">
              <Label htmlFor="weekly-note">Note (optional)</Label>
              <Textarea
                id="weekly-note"
                value={note}
                rows={3}
                maxLength={2000}
                placeholder="Anything the exec sync should know: wins, asks, decisions you need."
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => void copy()}>
                {copied ? <Check className="size-4" /> : <ClipboardCopy className="size-4" />}
                {copied ? "Copied" : "Copy as text"}
              </Button>
              <Button onClick={post} disabled={isPending || isFuture}>
                <Send className="size-4" />
                {posted?.postedAt ? "Update post" : "Post update"}
              </Button>
              {posted?.postedAt && (
                <span className="text-muted-foreground text-sm">
                  Posted {formatDistanceToNow(new Date(posted.postedAt), { addSuffix: true })}
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => void copy()}>
                {copied ? <Check className="size-4" /> : <ClipboardCopy className="size-4" />}
                {copied ? "Copied" : "Copy as text"}
              </Button>
              <span className="text-muted-foreground text-sm">
                {posted?.postedAt
                  ? `${personName} posted ${formatDistanceToNow(new Date(posted.postedAt), { addSuffix: true })}.`
                  : `${personName} hasn't posted this week's update.`}
              </span>
            </div>
            {posted?.note && <p className="text-sm whitespace-pre-wrap">{posted.note}</p>}
          </div>
        )}

        {posted?.postedAt && (
          <details className="rounded-lg border p-4 text-sm">
            <summary className="cursor-pointer font-medium">As posted</summary>
            <pre className="text-muted-foreground mt-3 font-sans whitespace-pre-wrap">
              {formatWeeklyText({
                personName,
                weekStart,
                lines: { done: posted.done, next: posted.next, blocked: posted.blocked },
                note: posted.note,
              })}
            </pre>
          </details>
        )}
      </div>

      <aside className="space-y-4">
        {canSeeWhoPosted && (
          <section className="rounded-lg border p-4" aria-labelledby="who-posted">
            <h2 id="who-posted" className="mb-3 text-sm font-semibold">
              Who hasn&apos;t posted ({notPosted.length})
            </h2>
            {expected.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Nobody is expected to post: leads come from the published org chart.
              </p>
            ) : (
              <ul className="space-y-2">
                {expected.map((e) => {
                  const m = memberById.get(e.userId);
                  const done = postedBy.has(e.userId);
                  return (
                    <li key={e.userId} className="flex items-center gap-2 text-sm">
                      {m && <UserAvatar user={m} size="xs" />}
                      <button
                        type="button"
                        className="min-w-0 flex-1 truncate text-left hover:underline"
                        onClick={() =>
                          navigate({ person: e.userId === viewer.userId ? null : e.userId })
                        }
                      >
                        {e.name ?? "Member"}
                      </button>
                      <span
                        className={cn(
                          "text-xs",
                          done ? "text-muted-foreground" : "text-destructive font-medium",
                        )}
                      >
                        {done ? "Posted" : "Not yet"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
        <p className="text-muted-foreground text-xs">
          Weeks run {WEEKDAY_NAMES[(dueDay + 1) % 7]} to {WEEKDAY_NAMES[dueDay]} in {org.timezone}.
          Leads who haven&apos;t posted get a reminder {WEEKDAY_NAMES[dueDay]} at 6pm. An owner or
          admin picks the day in Admin panel › General.
        </p>
      </aside>
    </div>
  );
}

function Column({
  title,
  items,
  kind,
}: {
  title: string;
  items: WeeklyItem[];
  kind: "done" | "next" | "blocked";
}) {
  const { org } = useTasks();
  return (
    <section className="rounded-lg border" aria-label={title}>
      <h2
        className={cn(
          "border-b px-3 py-2 text-sm font-semibold",
          kind === "blocked" && items.length > 0 && "text-destructive",
        )}
      >
        {title} <span className="text-muted-foreground font-normal">({items.length})</span>
      </h2>
      {items.length === 0 ? (
        <p className="text-muted-foreground px-3 py-3 text-sm">Nothing here.</p>
      ) : (
        <ul className="divide-y">
          {items.map((i) => (
            <li key={i.id} className="px-3 py-2 text-sm">
              <Link href={`/app/${org.slug}/tasks/${i.id}`} className="hover:underline">
                {i.isPrivate && (
                  <Lock
                    className="text-muted-foreground me-1 inline size-3 align-[-1px]"
                    aria-label="Private"
                  />
                )}
                {i.parentTitle && <span className="text-muted-foreground">{i.parentTitle} / </span>}
                {i.title}
              </Link>
              <div className="text-muted-foreground text-xs">
                {kind === "blocked" && i.blockedReason}
                {kind === "next" &&
                  (i.dueKey ? `Due ${formatDueKey(i.dueKey, org.todayKey)}` : "In progress")}
                {i.role === "collaborator" && " · involved"}
                {i.isPrivate && " · private, not posted"}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
