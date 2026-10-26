"use client";

import {
  Check,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType2,
  NotebookText,
  Presentation,
  type IconComponent,
} from "@/components/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * A folder on Files' Everything, drawn as a folder: a tab, a back panel, and
 * a front with the name on it. The newest few things inside are fanned out
 * above the front like papers half pulled out; the newest stands in the
 * middle with its name, the next two lean either side. They spread a little
 * on hover, and further while a file is dragged over (the "drop it here" cue).
 *
 * Every folder is the same quiet grey, taken from the theme's own surfaces.
 * Its colour is one short line on the tab. A folder nobody has coloured takes the
 * theme's colour (primary), so a new folder already matches the club. Whoever
 * may edit the folder clicks the line to pick another.
 *
 * The colour is stored as a token name (chart-1 … chart-5), not a colour, so
 * it is always read through var(--…).
 */

export type FolderCardType = "note" | "pdf" | "image" | "sheet" | "slides" | "doc" | "file";

export interface FolderCardPeek {
  id: string;
  kind: "note" | "file";
  type: FolderCardType;
  title: string;
  /** When it last changed (a note) or arrived (a file), ISO. */
  at: string;
}

export interface FolderCardProps {
  name: string;
  /** A token name, chart-1 … chart-5, or null for the theme's colour. */
  color: string | null;
  /** The colours to choose from (token names); without onColor, no choosing. */
  colors?: readonly string[];
  noteCount: number;
  fileCount: number;
  /** The newest few items, newest first. */
  peek: readonly FolderCardPeek[];
  /** A file is being dragged over it. */
  dropping?: boolean;
  onOpen: () => void;
  /** Set to let this viewer recolour the folder. */
  onColor?: (color: string | null) => void;
  /** Spread onto the folder: the library's drag-over / drop handlers. */
  dropProps?: React.HTMLAttributes<HTMLDivElement>;
}

const GLYPH: Record<FolderCardType, IconComponent> = {
  note: NotebookText,
  pdf: FileType2,
  image: FileImage,
  sheet: FileSpreadsheet,
  slides: Presentation,
  doc: FileText,
  file: File,
};

/** What a folder's colour token draws as; null is the theme's own colour. */
export function folderTone(color: string | null): string {
  return color ? `var(--${color})` : "var(--primary)";
}

/** "3 notes, 2 files" - what is in it, in words, rather than a bare total. */
function contents(notes: number, files: number): string {
  const parts = [
    notes > 0 && `${notes} ${notes === 1 ? "note" : "notes"}`,
    files > 0 && `${files} ${files === 1 ? "file" : "files"}`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "Empty";
}

/** "Today", "Yesterday", "3 days ago", then a date. */
export function when(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(now) - day(d)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== now.getFullYear() && { year: "numeric" }),
  });
}

/** Each sheet's resting angle and offset, by how many sheets there are. */
const FAN: Record<number, readonly { r: number; x: number }[]> = {
  1: [{ r: -2, x: 0 }],
  2: [
    { r: -3, x: -0.8 },
    { r: 6, x: 1.6 },
  ],
  3: [
    { r: -1, x: 0 },
    { r: -9, x: -2.1 },
    { r: 8, x: 2.1 },
  ],
};

const EASE = "duration-300 ease-(--ease-ink) motion-reduce:transition-none";

/** A few grey rules standing in for a page's text, so a sheet reads as paper. */
function Lines({ widths }: { widths: readonly number[] }) {
  return (
    <span aria-hidden="true" className="mt-2 flex flex-col gap-[5px]">
      {widths.map((w, i) => (
        <span
          key={i}
          className="bg-muted-foreground/15 h-[3px] rounded-full"
          style={{ width: `${w}%` }}
        />
      ))}
    </span>
  );
}

export function FolderCard({
  name,
  color,
  colors = [],
  noteCount,
  fileCount,
  peek,
  dropping = false,
  onOpen,
  onColor,
  dropProps,
}: FolderCardProps) {
  const summary = contents(noteCount, fileCount);
  const items = peek.slice(0, 3);
  const fan = FAN[items.length] ?? [];

  return (
    <div
      {...dropProps}
      data-dropping={dropping || undefined}
      style={
        {
          // The folder itself is the theme's grey: a step darker than the
          // card behind, a half step for the front.
          "--folder-back": "color-mix(in oklab, var(--foreground) 9%, var(--card))",
          "--folder-front": "color-mix(in oklab, var(--foreground) 4%, var(--card))",
        } as React.CSSProperties
      }
      className="group/folder relative pt-[18px]"
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${name}, ${summary.toLowerCase()}`}
        className="focus-glow absolute inset-0 z-30 rounded-[14px] outline-none"
      />

      {/* The tab, which carries the folder's colour. */}
      <span
        aria-hidden="true"
        className="absolute top-0 left-0 h-7 w-[42%] rounded-t-[10px]"
        style={{ backgroundColor: "var(--folder-back)" }}
      />

      <span
        aria-hidden="true"
        className={cn(
          "relative block h-36 overflow-hidden rounded-[14px] rounded-tl-none",
          "group-data-[dropping]/folder:ring-primary group-data-[dropping]/folder:ring-2",
        )}
        style={{ backgroundColor: "var(--folder-back)" }}
      >
        {/* The newest in the middle, in front of the two either side; only it is named. */}
        {items.map((item, i) => {
          const Glyph = GLYPH[item.type];
          const { r, x } = fan[i] ?? { r: 0, x: 0 };
          return (
            <span
              key={item.id}
              className={cn(
                "border-border/70 bg-raised text-muted-foreground absolute top-3 left-1/2 flex h-28 w-[62%] origin-bottom flex-col rounded-md border px-2.5 pt-2 text-[11px] leading-[1.15]",
                "shadow-[0_1px_2px_color-mix(in_oklab,var(--foreground)_8%,transparent)]",
                "[translate:calc(-50%+var(--x))_0] [rotate:var(--r)]",
                "transition-[translate,rotate]",
                EASE,
                "group-hover/folder:[translate:calc(-50%+var(--x)*1.35)_-5px] group-hover/folder:[rotate:calc(var(--r)*1.45)]",
                "group-data-[dropping]/folder:[translate:calc(-50%+var(--x)*1.7)_-12px] group-data-[dropping]/folder:[rotate:calc(var(--r)*1.9)]",
              )}
              style={
                {
                  "--r": `${r}deg`,
                  "--x": `${x}rem`,
                  zIndex: items.length - i,
                } as React.CSSProperties
              }
            >
              <span className="flex items-center gap-1.5">
                <Glyph className="size-3 shrink-0" strokeWidth={2} />
                {i === 0 && (
                  <span className="text-foreground/80 truncate font-medium">{item.title}</span>
                )}
              </span>
              <Lines widths={i === 0 ? [92, 78, 86] : [70, 88, 60]} />
            </span>
          );
        })}

        {/* The front of the folder, with the name on it. */}
        <span
          className={cn(
            "border-border/60 absolute inset-x-0 bottom-0 z-10 flex h-[4.6rem] flex-col justify-end gap-1 rounded-[14px] border px-3.5 pb-3",
            "shadow-[0_-8px_16px_-10px_color-mix(in_oklab,var(--foreground)_28%,transparent),inset_0_1px_0_color-mix(in_oklab,var(--card)_70%,transparent)]",
            "transition-[box-shadow]",
            EASE,
            "group-hover/folder:shadow-e1",
          )}
          style={{ backgroundColor: "var(--folder-front)" }}
        >
          <span className="truncate text-sm leading-tight font-medium">{name}</span>
          <span className="text-muted-foreground flex items-baseline justify-between gap-2 text-[12px] leading-tight">
            <span className="truncate">{dropping ? "Drop to move it here" : summary}</span>
            {!dropping && items[0] && (
              <span className="shrink-0 tabular-nums" suppressHydrationWarning>
                {when(items[0].at)}
              </span>
            )}
          </span>
        </span>
      </span>

      {/* The colour line on the tab: a button for whoever may recolour it. */}
      {onColor ? (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`${name} colour`}
              title="Folder colour"
              className="focus-glow absolute top-0 left-2 z-40 flex h-[18px] w-11 items-center justify-start rounded-md px-1.5 outline-none"
            >
              <Stripe color={color} interactive />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-2">
            <div className="flex gap-1.5" role="group" aria-label="Folder colour">
              {[null, ...colors].map((c) => (
                <button
                  key={c ?? "theme"}
                  type="button"
                  aria-label={c ? `Colour ${c.replace("chart-", "")}` : "Match the theme"}
                  aria-pressed={color === c}
                  title={c ? undefined : "Match the theme"}
                  onClick={() => onColor(c)}
                  className="focus-glow grid size-7 place-items-center rounded-full outline-none"
                >
                  <span
                    className={cn(
                      "grid size-5 place-items-center rounded-full",
                      color === c && "ring-foreground ring-offset-popover ring-2 ring-offset-2",
                    )}
                    style={{ backgroundColor: folderTone(c) }}
                  >
                    {color === c && (
                      <Check
                        className="size-3"
                        style={{ color: "var(--card)" }}
                        strokeWidth={3}
                        aria-hidden="true"
                      />
                    )}
                  </span>
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      ) : (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-0 left-2 z-40 flex h-[18px] items-center px-1.5"
        >
          <Stripe color={color} />
        </span>
      )}
    </div>
  );
}

function Stripe({ color, interactive = false }: { color: string | null; interactive?: boolean }) {
  return (
    <span
      className={cn(
        "block h-1 w-7 origin-left rounded-full",
        "shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_10%,transparent)]",
        interactive &&
          "transition-transform duration-200 ease-(--ease-ink) group-hover/folder:scale-x-110 hover:scale-x-125 motion-reduce:transition-none",
      )}
      style={{ backgroundColor: folderTone(color) }}
    />
  );
}
