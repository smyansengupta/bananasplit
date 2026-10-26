import { Bookmark, Layers, SquareCheck, type IconComponent } from "@/components/icons";
import type { CSSProperties } from "react";

import { TASK_TYPES, typeLabel, type TaskTypeValue } from "@/lib/tasks/hierarchy";
import { cn } from "@/lib/utils";

export const TYPE_ICON: Record<TaskTypeValue, IconComponent> = {
  EPIC: Layers,
  STORY: Bookmark,
  TASK: SquareCheck,
};

/** The editor's Type segments. */
export const TYPE_OPTIONS = TASK_TYPES.map((t) => {
  const Icon = TYPE_ICON[t.value];
  return {
    value: t.value,
    label: t.label,
    icon: <Icon className="size-[15px]" aria-hidden="true" />,
  };
});

/** Epics take chart slot 4, stories slot 2; a plain task is a quiet fill. */
const TYPE_TINT: Record<TaskTypeValue, string | null> = {
  EPIC: "var(--chart-4)",
  STORY: "var(--chart-2)",
  TASK: null,
};

/**
 * The type chip: Epic (layers), Story (bookmark), Task (check-square). A
 * 24px pill, the type's chart colour mixed into the card behind ink text.
 */
export function TaskTypeChip({
  type,
  className,
  iconOnly = false,
}: {
  type: string;
  className?: string;
  /** Just the icon (with the word for screen readers), for tight rows. */
  iconOnly?: boolean;
}) {
  const t = (type in TYPE_ICON ? type : "TASK") as TaskTypeValue;
  const Icon = TYPE_ICON[t];
  const tint = TYPE_TINT[t];
  return (
    <span
      style={tint ? ({ "--type": tint } as CSSProperties) : undefined}
      className={cn(
        "text-foreground inline-flex h-6 shrink-0 items-center gap-[5px] rounded-full text-xs font-semibold whitespace-nowrap",
        iconOnly ? "w-6 justify-center" : "ps-[7px] pe-[9px]",
        tint ? "bg-[color-mix(in_oklab,var(--type)_20%,var(--card))]" : "bg-muted",
        className,
      )}
      title={iconOnly ? typeLabel(t) : undefined}
    >
      <Icon className="size-3.5" strokeWidth={2} aria-hidden="true" />
      <span className={iconOnly ? "sr-only" : undefined}>{typeLabel(t)}</span>
    </span>
  );
}

/** A thin progress bar in a colour, with "2/3" after it (cards, epics, stories). */
export function ProgressBar({
  done,
  total,
  color,
  className,
}: {
  done: number;
  total: number;
  /** A CSS colour: the project's, or a theme token. */
  color: string;
  className?: string;
}) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <span
      className={cn(
        "text-muted-foreground flex items-center gap-2 text-xs font-semibold tabular-nums",
        className,
      )}
    >
      <span
        role="img"
        aria-label={`${done} of ${total} done`}
        className="bg-muted h-[5px] min-w-8 flex-1 overflow-hidden rounded-full"
      >
        <span
          className="block h-full rounded-full transition-[width] duration-500 ease-(--ease-ink)"
          style={{ width: `${pct}%`, background: color }}
        />
      </span>
      {done}/{total}
    </span>
  );
}
