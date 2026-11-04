import { ArrowUpRight, Check, Loader2, type IconComponent } from "@/components/icons";
import Link from "next/link";
import type { DragEventHandler, ReactNode } from "react";

import { Gauge } from "@/components/ui/meters";
import { cn } from "@/lib/utils";

/**
 * The "get started" block, shared by Home's "Get your organization started"
 * and the CRM's "Get your CRM started": a Progress block across the page. On
 * the left, the title, the gauge and a rail of one segment per step (solid
 * when done, dashed when not needed). On the right, only what's left, each
 * step a tile with its own icon; what's finished folds into a row of small
 * checked chips under them, each with Undo when it was only checked off.
 * Each page says what its steps are and what its tiles do.
 */

export type StartedStatus = "done" | "skipped" | "todo";

export interface StartedRailStep {
  key: string;
  label: string;
  status: StartedStatus;
  icon: IconComponent;
}

/** The white pill on a block: a tile's main button. */
export const STARTED_SOLID =
  "text-block-goal inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full bg-white px-2.5 text-[12px] font-semibold transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-60";

/** The outlined pill on a block: a tile's other buttons. */
export const STARTED_RING =
  "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-[12px] font-semibold ring-1 ring-current/25 transition-colors hover:ring-current/60 disabled:cursor-default disabled:opacity-60";

/** A field on a block. */
export const STARTED_FIELD =
  "placeholder:text-current/55 min-w-0 rounded-[12px] bg-current/10 px-3 py-1.5 text-[13px] ring-1 ring-current/20 outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-current/60";

export function StartedBlock({
  title,
  steps,
  foot,
  error,
  finished,
  children,
}: {
  title: string;
  steps: readonly StartedRailStep[];
  /** The row along the bottom: Hide, and any links. */
  foot?: ReactNode;
  error?: string | null;
  /** The chips for what's finished (StartedChips). */
  finished?: ReactNode;
  /** The tiles (StartedTile). */
  children: ReactNode;
}) {
  const total = steps.length;
  const done = steps.filter((step) => step.status !== "todo").length;
  const left = total - done;
  return (
    <section
      aria-labelledby="started-heading"
      className="bg-block-goal text-block-goal-foreground rounded-block relative isolate overflow-hidden p-6 sm:p-8"
    >
      {/* A soft top light, as on every block, and a wide glow behind the gauge. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-linear-to-b from-white/7 to-transparent to-45%"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 -left-24 -z-10 size-80 rounded-full bg-white/6 blur-3xl"
      />
      <div className="grid gap-x-10 gap-y-6 lg:grid-cols-[minmax(15rem,19rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <div>
            <div className="min-w-0">
              <h2
                id="started-heading"
                className="display-title m-0 text-[clamp(1.5rem,1.15rem+1.2vw,2rem)] leading-[1.1]"
              >
                {title}
              </h2>
              <p className="mt-2 text-[14px] text-(--block-goal-meta)">
                {left === 1 ? "One step left." : `${left} steps left.`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-5">
            <Gauge
              value={total ? (done / total) * 100 : 0}
              caption={`${done} of ${total}`}
              size={124}
            />
            <ol
              aria-label={`${done} of ${total} steps finished`}
              className="grid min-w-0 flex-1 grid-cols-4 gap-1.5"
            >
              {steps.map((step) => {
                const Icon = step.icon;
                return (
                  <li
                    key={step.key}
                    title={step.label}
                    className={cn(
                      "grid aspect-square place-items-center rounded-[10px] transition-colors",
                      step.status === "done" && "text-block-goal bg-white",
                      step.status === "skipped" && "border-[1.5px] border-dashed border-current/45",
                      step.status === "todo" && "bg-current/12",
                    )}
                  >
                    <Icon
                      className={cn("size-4", step.status === "skipped" && "opacity-60")}
                      aria-hidden="true"
                    />
                    <span className="sr-only">
                      {step.label}
                      {step.status === "done"
                        ? " (done)"
                        : step.status === "skipped"
                          ? " (not needed)"
                          : " (to do)"}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>

        <div className="min-w-0 space-y-4">
          <ul className="grid list-none gap-2.5 p-0 sm:grid-cols-2">{children}</ul>
          {finished}
        </div>
      </div>

      {foot && (
        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-current/15 pt-5 text-[13px] font-semibold">
          {foot}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-[14px] font-semibold">
          {error}
        </p>
      )}
    </section>
  );
}

/**
 * One step left to do. With `href` the whole tile is a link to where the
 * job is done; without it, `children` do the job right here.
 */
export function StartedTile({
  icon: Icon,
  label,
  hint,
  href,
  wide = false,
  children,
  onDragOver,
  onDragLeave,
  onDrop,
  highlighted = false,
}: {
  icon: IconComponent;
  label: string;
  hint: string;
  href?: string;
  /** Takes the whole row: a step with more to choose from. */
  wide?: boolean;
  /** The tile's buttons, under the label. */
  children?: ReactNode;
  onDragOver?: DragEventHandler<HTMLLIElement>;
  onDragLeave?: DragEventHandler<HTMLLIElement>;
  onDrop?: DragEventHandler<HTMLLIElement>;
  /** A file is being held over it. */
  highlighted?: boolean;
}) {
  return (
    <li
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        "rounded-tile group/step relative flex flex-col gap-3 bg-[color-mix(in_oklab,currentColor_10%,transparent)] p-4 transition-colors hover:bg-[color-mix(in_oklab,currentColor_15%,transparent)]",
        wide && "sm:col-span-2",
        highlighted &&
          "bg-[color-mix(in_oklab,currentColor_22%,transparent)] ring-2 ring-current/50",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="text-block-goal grid size-10 flex-none place-items-center rounded-[12px] bg-white shadow-[0_2px_6px_rgb(0_0_0/0.18)]"
        >
          <Icon className="size-5" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          {href ? (
            <Link
              href={href}
              className="text-[15px] leading-[1.3] font-semibold outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:after:outline-2 focus-visible:after:outline-current"
            >
              {label}
            </Link>
          ) : (
            <span className="text-[15px] leading-[1.3] font-semibold">{label}</span>
          )}
          <span className="text-[13px] leading-[1.4] text-(--block-goal-meta)">{hint}</span>
        </span>
        {href && (
          <ArrowUpRight
            className="size-4 flex-none opacity-60 transition-transform group-hover/step:translate-x-0.5 group-hover/step:-translate-y-0.5"
            aria-hidden="true"
          />
        )}
      </div>
      {children && (
        <div className="relative z-10 flex flex-wrap items-center gap-1.5 pl-[3.25rem]">
          {children}
        </div>
      )}
    </li>
  );
}

/** "Not needed" on a tile: checks the step off. */
export function StartedSkip({ working, onClick }: { working: boolean; onClick: () => void }) {
  return (
    <button type="button" disabled={working} onClick={onClick} className={STARTED_RING}>
      {working ? <Loader2 className="size-3.5 animate-spin" aria-label="Saving" /> : "Not needed"}
    </button>
  );
}

/** What's finished, as small checked chips; Undo on the ones only checked off. */
export function StartedChips({
  steps,
  busy,
  onUndo,
}: {
  steps: readonly { key: string; label: string; status: StartedStatus; href: string }[];
  /** The step being saved. */
  busy?: string | null;
  onUndo: (key: string) => void;
}) {
  if (steps.length === 0) return null;
  return (
    <ul className="flex list-none flex-wrap gap-1.5 p-0" aria-label="Finished">
      {steps.map((step) => (
        <li
          key={step.key}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-full pr-3 pl-1.5 text-[12.5px] font-medium",
            step.status === "done"
              ? "bg-current/10"
              : "border border-dashed border-current/35 pr-1.5",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "grid size-5 place-items-center rounded-full",
              step.status === "done" ? "text-block-goal bg-white" : "bg-current/15",
            )}
          >
            <Check className="size-3" strokeWidth={3} />
          </span>
          <Link href={step.href} className="underline-offset-4 hover:underline">
            {step.label}
          </Link>
          <span className="sr-only">{step.status === "done" ? " (done)" : " (not needed)"}</span>
          {step.status === "skipped" && (
            <button
              type="button"
              disabled={busy === step.key}
              onClick={() => onUndo(step.key)}
              className="h-6 cursor-pointer rounded-full bg-current/12 px-2 text-[11.5px] font-semibold transition-colors hover:bg-current/20 disabled:opacity-60"
            >
              Undo
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Hide, at the end of the block's bottom row. */
export function StartedHide({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="ms-auto h-8 cursor-pointer rounded-full px-3.5 text-[13px] font-semibold transition-colors hover:bg-current/10 disabled:opacity-60"
    >
      Hide
    </button>
  );
}

/** A link in the block's bottom row. */
export function StartedExtra({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex h-8 items-center gap-1 rounded-full px-3 ring-1 ring-current/20 transition-colors hover:bg-current/10"
    >
      {label}
      <ArrowUpRight className="size-3.5 opacity-60" aria-hidden="true" />
    </Link>
  );
}
