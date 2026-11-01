"use client";

import { CheckSquare } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";

import { addLinkAction } from "@/app/app/[orgSlug]/links/actions";
import { createNote } from "@/app/app/[orgSlug]/notes/actions";
import { createTask } from "@/app/app/[orgSlug]/tasks/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { parseCapture } from "@/lib/overview/capture";
import { runAction } from "@/lib/run-action";
import { formatDueKey } from "@/lib/tasks/dates";
import type { QuickCaptureData } from "@/server/overview/quick-capture";

import { LinkChip } from "./connections";

/**
 * Quick capture (Overview, one column): one line, and a preview of what it
 * becomes as you type (src/lib/overview/capture.ts). A task for you by
 * default, due on the date the line names and linked to the event it names;
 * or a note, on that event. Both go through the same actions as Tasks and
 * Notes (createTask, then addLinkAction for the event; createNote).
 *
 * Only a date and an event are read from the line. Amounts ("$40 for
 * pizza") stay in the title: there's no cost parsing, and nothing here
 * touches Finance.
 */

function errorOf(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  if ("error" in result && typeof result.error === "string") return result.error;
  if ("confirm" in result && result.confirm) return "Open Tasks to confirm this assignment.";
  return null;
}

export function QuickCapture({
  orgId,
  orgSlug,
  viewerId,
  data,
}: {
  orgId: string;
  orgSlug: string;
  viewerId: string;
  data: QuickCaptureData;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const base = `/app/${orgSlug}`;
  const capture = parseCapture(text, data.todayKey, data.events);
  const ready = capture.title.trim().length > 0;

  const addTask = () =>
    start(async () => {
      if (!ready) return;
      const result = await runAction(() =>
        createTask(orgId, {
          title: capture.title.slice(0, 200),
          dueDate: capture.dueKey,
          ownerId: viewerId,
        }),
      );
      if (result === undefined) return;
      const failed = errorOf(result);
      if (failed || !("taskId" in result) || !result.taskId) {
        toast({ title: failed ?? "Couldn't add the task.", tone: "error" });
        return;
      }
      const taskId = result.taskId;
      if (capture.event) {
        const event = capture.event;
        const linked = await runAction(
          () =>
            addLinkAction(
              orgId,
              orgSlug,
              { kind: "task", id: taskId },
              { kind: "event", id: event.id },
            ),
          "Added, but not linked to the event.",
        );
        if (linked?.error)
          toast({ title: `Added, but not linked: ${linked.error}`, tone: "error" });
      }
      setText("");
      input.current?.focus();
      router.refresh();
      toast({
        title: "Task added",
        tone: "success",
        action: { label: "Open", run: () => router.push(`${base}/tasks/${taskId}`) },
      });
    });

  const addNote = () =>
    start(async () => {
      if (!ready) return;
      const result = await runAction(() =>
        createNote(orgId, {
          title: capture.title.slice(0, 300),
          eventId: capture.event?.id,
        }),
      );
      if (result === undefined) return;
      if (result.error || !result.noteId) {
        toast({ title: result.error ?? "Couldn't make the note.", tone: "error" });
        return;
      }
      setText("");
      router.push(`${base}/notes/${result.noteId}`);
    });

  return (
    <div className="space-y-3.5">
      <p id={hintId} className="text-muted-foreground text-[13px]">
        Type a task. A date or an event&apos;s name in it is picked up as you type.
      </p>
      <Input
        ref={input}
        aria-describedby={hintId}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing && !pending) {
            e.preventDefault();
            addTask();
          }
        }}
        placeholder="Order pizza for the social by Wed"
        aria-label="Quick capture"
        maxLength={300}
        readOnly={pending}
        aria-busy={pending || undefined}
      />
      <div aria-live="polite">
        {ready && (
          <div className="bg-muted/60 rounded-tile space-y-1.5 px-3.5 py-3 text-[13px]">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <CheckSquare className="text-tint-info-foreground size-4" aria-hidden="true" />A task
              for you
            </p>
            <dl className="space-y-1">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Due</dt>
                <dd className="font-semibold">
                  {capture.dueKey ? formatDueKey(capture.dueKey, data.todayKey) : "No date"}
                </dd>
              </div>
              {capture.event && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Linked to</dt>
                  <dd className="min-w-0">
                    <LinkChip
                      item={{
                        kind: "event",
                        label: capture.event.title,
                        href: `${base}/calendar/${capture.event.id}`,
                      }}
                    />
                  </dd>
                </div>
              )}
            </dl>
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <Button className="flex-1" disabled={!ready || pending} onClick={addTask}>
          Add task
        </Button>
        <Button variant="outline" disabled={!ready || pending} onClick={addNote}>
          Make it a note
        </Button>
      </div>
    </div>
  );
}
