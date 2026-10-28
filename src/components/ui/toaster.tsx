"use client";

import { CheckCircle2, Loader2, X, XCircle } from "@/components/icons";
import { useState, useSyncExternalStore, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Small notices in the corner: "Note deleted · Undo". The store lives in
 * this module, so a toast raised just before a navigation (delete a note,
 * go back to the list) is still there on the next page; <Toaster /> is
 * mounted once in the app shell.
 *
 *   toast({ title: "Note deleted", action: { label: "Undo", run: () => restoreNote(...) } })
 */

export interface ToastAction {
  label: string;
  /** Runs once; return an error message to show instead of closing. */
  run: () => Promise<string | null | undefined | void> | void;
}

export interface ToastInput {
  title: ReactNode;
  description?: ReactNode;
  tone?: "default" | "success" | "error";
  action?: ToastAction;
  /** Milliseconds before it goes away (default 7000, 10000 with an action). */
  duration?: number;
}

interface ToastItem extends ToastInput {
  id: number;
}

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emit() {
  for (const listener of listeners) listener();
}

export function dismissToast(id: number) {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
  items = items.filter((t) => t.id !== id);
  emit();
}

function schedule(id: number, ms: number) {
  const old = timers.get(id);
  if (old) clearTimeout(old);
  timers.set(
    id,
    setTimeout(() => dismissToast(id), ms),
  );
}

/** Shows a toast; returns its id. At most four at a time (the oldest goes). */
export function toast(input: ToastInput): number {
  const id = nextId++;
  items = [...items.slice(-3), { ...input, id }];
  emit();
  schedule(id, input.duration ?? (input.action ? 10_000 : 7_000));
  return id;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = () => items;
// One shared empty list: a new [] per call would make React re-render forever.
const NO_TOASTS: ToastItem[] = [];
const serverSnapshot = () => NO_TOASTS;

export function Toaster() {
  const list = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return (
    <div
      aria-live="polite"
      role="region"
      aria-label="Notifications"
      className="pointer-events-none fixed inset-x-0 top-4 z-[60] mx-auto flex w-[calc(100%-2rem)] max-w-md flex-col items-center gap-2 max-md:top-auto max-md:bottom-[calc(5.75rem+env(safe-area-inset-bottom))]"
    >
      {list.map((t) => (
        <ToastCard key={t.id} item={t} />
      ))}
    </div>
  );
}

function ToastCard({ item }: { item: ToastItem }) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const Icon = item.tone === "error" ? XCircle : item.tone === "success" ? CheckCircle2 : null;
  return (
    <div
      role="status"
      className={cn(
        "glass animate-in fade-in-0 zoom-in-95 slide-in-from-top-3 max-md:slide-in-from-bottom-3 pointer-events-auto relative flex max-w-full gap-3 py-1.5 pr-1.5 pl-2 duration-500 ease-(--ease-spring) motion-reduce:animate-none",
        item.description || error ? "items-start rounded-[1.5rem]" : "items-center rounded-full",
      )}
      onMouseEnter={() => {
        const timer = timers.get(item.id);
        if (timer) clearTimeout(timer);
      }}
      onMouseLeave={() => schedule(item.id, 4_000)}
    >
      {Icon && (
        <span
          className={cn(
            "grid size-[30px] shrink-0 place-items-center rounded-full",
            item.tone === "error"
              ? "bg-block-alert text-block-alert-foreground"
              : "bg-block-goal text-block-goal-foreground",
          )}
        >
          <Icon className="size-4" aria-hidden="true" />
        </span>
      )}
      <div
        className={cn(
          "min-w-0 flex-1 text-sm",
          !Icon && "pl-2",
          (item.description || error) && "py-1",
        )}
      >
        <p className="truncate font-semibold">{item.title}</p>
        {item.description && (
          <p className="mt-0.5 text-xs text-[color-mix(in_oklab,var(--chrome-foreground)_66%,transparent)]">
            {item.description}
          </p>
        )}
        {error && <p className="text-tint-danger-foreground mt-1 text-xs">{error}</p>}
      </div>
      {item.action && (
        <button
          type="button"
          disabled={running}
          onClick={async () => {
            setRunning(true);
            setError(null);
            try {
              const result = await item.action!.run();
              if (typeof result === "string" && result) setError(result);
              else dismissToast(item.id);
            } catch {
              setError("That didn't work. Try again.");
            } finally {
              setRunning(false);
            }
          }}
          className="text-chrome-foreground inline-flex h-[34px] shrink-0 items-center gap-1 rounded-full bg-[color-mix(in_oklab,var(--chrome-foreground)_15%,transparent)] px-3.5 text-[0.8125rem] font-semibold transition-colors hover:bg-[color-mix(in_oklab,var(--chrome-foreground)_22%,transparent)]"
        >
          {running && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
          {item.action.label}
        </button>
      )}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => dismissToast(item.id)}
        className="hover:text-chrome-foreground grid size-[30px] shrink-0 place-items-center rounded-full text-[color-mix(in_oklab,var(--chrome-foreground)_66%,transparent)] transition-colors hover:bg-[color-mix(in_oklab,var(--chrome-foreground)_12%,transparent)]"
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
