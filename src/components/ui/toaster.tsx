"use client";

import { CheckCircle2, Loader2, X, XCircle } from "lucide-react";
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
      className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[calc(100%-2rem)] max-w-sm flex-col items-end gap-2"
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
      className="bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-bottom-2 pointer-events-auto flex w-full items-start gap-3 rounded-xl border p-3 pr-2 shadow-lg"
      onMouseEnter={() => {
        const timer = timers.get(item.id);
        if (timer) clearTimeout(timer);
      }}
      onMouseLeave={() => schedule(item.id, 4_000)}
    >
      {Icon && (
        <Icon
          className={cn("mt-0.5 size-4 shrink-0", item.tone === "error" ? "text-destructive" : "text-success")}
          aria-hidden="true"
        />
      )}
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">{item.title}</p>
        {item.description && <p className="text-muted-foreground mt-0.5 text-xs">{item.description}</p>}
        {error && <p className="text-destructive mt-1 text-xs">{error}</p>}
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
          className="text-primary hover:bg-primary/10 inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-sm font-semibold"
        >
          {running && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
          {item.action.label}
        </button>
      )}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => dismissToast(item.id)}
        className="text-muted-foreground hover:text-foreground hover:bg-muted grid size-6 shrink-0 place-items-center rounded-md"
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
