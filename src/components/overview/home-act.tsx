"use client";

import {
  DoorOpen,
  Inbox,
  ListTodo,
  Megaphone,
  NotebookPen,
  Send,
  Users,
  Video,
  Zap,
  type IconComponent,
} from "@/components/icons";
import Link from "next/link";

import { AmbientButton, type AmbientTone } from "@/components/ambient/ambient-button";
import { setTaskStatus } from "@/app/app/[orgSlug]/tasks/actions";
import type { HomeAct, HomeActKind } from "@/lib/overview/home-acts";

/** Each Home act's words and icon. */
const LOOK: Record<HomeActKind, { label: string; icon: IconComponent }> = {
  join: { label: "Join", icon: Video },
  "check-in": { label: "Open check-in", icon: DoorOpen },
  "draft-agenda": { label: "Draft agenda", icon: NotebookPen },
  "add-notes": { label: "Add notes", icon: NotebookPen },
  "thank-you": { label: "Send a thank-you", icon: Send },
  "review-late": { label: "Review late", icon: ListTodo },
  approvals: { label: "Review approvals", icon: Inbox },
  "post-recap": { label: "Post the recap", icon: Megaphone },
  "join-them": { label: "Join them", icon: Users },
};

/** One of Home's ambient buttons, from the plain data the server picked. */
export function HomeActButton({
  act,
  tone = "outline",
  className,
}: {
  act: HomeAct;
  tone?: AmbientTone;
  className?: string;
}) {
  const look = LOOK[act.kind];
  return (
    <AmbientButton
      className={className}
      action={{
        key: act.kind,
        label: look.label,
        icon: look.icon,
        reason: act.reason,
        tone,
        href: act.href,
        external: act.external,
      }}
    />
  );
}

/**
 * The same act on a card with its own colours (Up next): it takes the
 * card's ink and the card's button shape, `className`, instead of the pill.
 */
export function HomeActCardLink({ act, className }: { act: HomeAct; className: string }) {
  const { label, icon: Icon } = LOOK[act.kind];
  const inner = (
    <>
      <Icon className="size-3.5" aria-hidden="true" />
      {label}
    </>
  );
  return act.external ? (
    <a href={act.href} target="_blank" rel="noreferrer" title={act.reason} className={className}>
      {inner}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  ) : (
    <Link href={act.href} title={act.reason} className={className}>
      {inner}
    </Link>
  );
}

/** Deadlines: a task due within two days that nobody has started. Start it, right here. */
export function StartItButton({
  orgId,
  taskId,
  title,
}: {
  orgId: string;
  taskId: string;
  title: string;
}) {
  return (
    <AmbientButton
      action={{
        key: "start",
        label: "Start it",
        icon: Zap,
        tone: "solid",
        reason: "Due soon, not started",
        ariaLabel: `Start ${title}`,
        run: () => setTaskStatus(orgId, taskId, "IN_PROGRESS"),
        done: `${title} is in progress`,
      }}
    />
  );
}
