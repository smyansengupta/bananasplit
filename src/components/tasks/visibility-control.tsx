"use client";

import { Globe, Lock } from "lucide-react";

import { UserAvatar } from "@/components/user-avatar";
import { TaskVisibility } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

import { useTasks } from "./tasks-context";

/**
 * Who can see this task (C4).
 *
 * Privacy is not a checkbox in an overflow menu here. It is two labelled
 * options with their consequence written underneath, sitting in the form
 * next to owner and due date, and when a task is private the panel lists the
 * actual people by name and face. "Private" that you cannot audit is worse
 * than no privacy at all: you want to be able to answer "so who sees this?"
 * without thinking.
 */

const OPTIONS = [
  {
    value: TaskVisibility.ORG,
    icon: Globe,
    label: "Everyone",
    hint: "Anyone in the club can find and open this task.",
  },
  {
    value: TaskVisibility.PRIVATE,
    icon: Lock,
    label: "Private",
    hint: "Only the people on it, plus owners and admins.",
  },
] as const;

export function VisibilityControl({
  id,
  value,
  onChange,
  disabled,
  lockedReason,
}: {
  id?: string;
  value: TaskVisibility;
  onChange: (next: TaskVisibility) => void;
  disabled?: boolean;
  /** Set when the control cannot be used at all, and why. */
  lockedReason?: string | null;
}) {
  const active = OPTIONS.find((o) => o.value === value) ?? OPTIONS[0];
  return (
    <div className="grid gap-1.5">
      <div
        id={id}
        role="radiogroup"
        aria-label="Who can see this task"
        className="bg-muted grid grid-cols-2 gap-1 rounded-lg p-1"
      >
        {OPTIONS.map((option) => {
          const Icon = option.icon;
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={cn(
                "focus-visible:ring-ring flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50",
                selected
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {option.label}
            </button>
          );
        })}
      </div>
      <p className="text-muted-foreground text-xs">{lockedReason ?? active.hint}</p>
    </div>
  );
}

/** The audience, by name, for a private task. */
export function AudienceList({
  ownerId,
  createdById,
  assigneeIds,
  className,
}: {
  ownerId: string | null;
  createdById: string;
  assigneeIds: readonly string[];
  className?: string;
}) {
  const { memberById } = useTasks();
  const seen = new Set<string>();
  const people: { id: string; role: string }[] = [];
  const push = (id: string | null, role: string) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    people.push({ id, role });
  };
  push(ownerId, "owner");
  for (const id of assigneeIds) push(id, "involved");
  push(createdById, "created it");

  return (
    <div className={cn("space-y-2", className)}>
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        Who can see this
      </p>
      <ul className="flex flex-wrap gap-x-4 gap-y-2">
        {people.map((p) => {
          const member = memberById.get(p.id);
          return (
            <li key={p.id} className="flex items-center gap-2 text-sm">
              {member ? <UserAvatar user={member} size="xs" /> : null}
              <span>{member?.name ?? "A former member"}</span>
              <span className="text-muted-foreground text-xs">{p.role}</span>
            </li>
          );
        })}
        <li className="text-muted-foreground flex items-center gap-2 text-sm">
          <span className="bg-muted text-muted-foreground inline-flex size-5 items-center justify-center rounded-full">
            <Lock className="size-3" aria-hidden="true" />
          </span>
          Owners and admins
        </li>
      </ul>
    </div>
  );
}
