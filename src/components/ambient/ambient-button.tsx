"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import type { IconComponent } from "@/components/icons";
import { toast } from "@/components/ui/toaster";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";

/**
 * Ambient buttons (Home canvas, "Ambient buttons"): a button that shows up
 * only when the state calls for it, does the job right there, says why it's
 * here, and goes away once it's done. At most two on any one thing.
 *
 * The page decides when one shows (its condition is the reason); this
 * draws it the same way everywhere: a small pill, the reason on hover and,
 * where there's room, as a line with a banana dot under the row.
 */

export type AmbientTone = "solid" | "outline" | "spark";

/** What a server action hands back: an error to show, or anything else for done. */
type Outcome = { error?: string | null } | { ok: false; error: string } | unknown;

export interface AmbientAction {
  /** Stable within the row. */
  key: string;
  label: string;
  icon?: IconComponent;
  /** Why it's here ("Due tomorrow, not started"). Shown on hover, and under the row by AmbientActions. */
  reason: string;
  tone?: AmbientTone;
  /** A link: where the job is done (a page, a dialog opened by a query). */
  href?: string;
  /** Opens in a new tab (a call's Join). */
  external?: boolean;
  /** The job itself, in place. Its result's `error` is shown; anything else counts as done. */
  run?: () => Promise<Outcome>;
  /** The toast once `run` is done. */
  done?: string;
  /** Screen readers: the label with what it's about ("Push back Book the room"). */
  ariaLabel?: string;
}

const TONE: Record<AmbientTone, string> = {
  solid: "bg-foreground text-background hover:bg-foreground/90",
  outline:
    "bg-transparent text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,currentColor_28%,transparent)] hover:bg-current/8",
  spark:
    "bg-[color-mix(in_oklab,var(--attention)_22%,var(--card))] text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--attention)_40%,transparent)] hover:bg-[color-mix(in_oklab,var(--attention)_30%,var(--card))]",
};

export const AMBIENT_BUTTON =
  "focus-glow inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold whitespace-nowrap transition-[background-color,transform] outline-none active:scale-[0.97] disabled:pointer-events-none disabled:opacity-55 [&_svg]:size-3.5 [&_svg]:shrink-0";

function failed(result: Outcome): string | null {
  if (!result || typeof result !== "object") return null;
  const r = result as { ok?: boolean; error?: unknown };
  if (typeof r.error === "string" && r.error) return r.error;
  if (r.ok === false) return "That didn't go through. Try again.";
  return null;
}

/** One ambient button. A link when it has `href`; otherwise it runs its job and goes. */
export function AmbientButton({
  action,
  className,
}: {
  action: AmbientAction;
  className?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [gone, setGone] = useState(false);
  if (gone) return null;
  const { icon: Icon, tone = "outline" } = action;
  const look = cn(AMBIENT_BUTTON, TONE[tone], className);
  const inner = (
    <>
      {Icon && <Icon aria-hidden="true" />}
      {action.label}
    </>
  );
  if (action.href) {
    return action.external ? (
      <a
        href={action.href}
        target="_blank"
        rel="noreferrer"
        title={action.reason}
        aria-label={action.ariaLabel}
        className={look}
      >
        {inner}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    ) : (
      <Link href={action.href} title={action.reason} aria-label={action.ariaLabel} className={look}>
        {inner}
      </Link>
    );
  }
  return (
    <button
      type="button"
      title={action.reason}
      aria-label={action.ariaLabel}
      disabled={pending}
      className={look}
      onClick={(e) => {
        // Rows are often links themselves: the button does its job, not the row's.
        e.preventDefault();
        e.stopPropagation();
        if (!action.run) return;
        start(async () => {
          const result = await runAction(action.run!);
          if (result === undefined) return;
          const error = failed(result);
          if (error) {
            toast({ title: error, tone: "error" });
            return;
          }
          if (action.done) toast({ title: action.done });
          setGone(true);
          router.refresh();
        });
      }}
    >
      {inner}
    </button>
  );
}

/** The reason line: a banana dot and a few words. */
export function AmbientWhy({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "text-muted-foreground flex items-center gap-1.5 text-[11.5px] leading-tight before:size-1.5 before:shrink-0 before:rounded-full before:bg-(--attention) before:content-['']",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** At most two ambient buttons for one thing. */
export const MAX_AMBIENT = 2;

/**
 * The ambient buttons for one row or card, the first two only, and (with
 * `why`) the first one's reason under them. Nothing at all when there are none.
 */
export function AmbientActions({
  actions,
  why = false,
  className,
}: {
  actions: readonly (AmbientAction | null | false | undefined)[];
  why?: boolean;
  className?: string;
}) {
  const shown = actions.filter((a): a is AmbientAction => Boolean(a)).slice(0, MAX_AMBIENT);
  if (shown.length === 0) return null;
  return (
    <span className={cn("inline-flex min-w-0 flex-col items-end gap-1", className)}>
      <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
        {shown.map((a) => (
          <AmbientButton key={a.key} action={a} />
        ))}
      </span>
      {why && <AmbientWhy>{shown[0].reason}</AmbientWhy>}
    </span>
  );
}
