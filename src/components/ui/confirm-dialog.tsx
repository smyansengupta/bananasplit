"use client";

import { Loader2, TriangleAlert } from "lucide-react";
import { useCallback, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * The one way to ask "are you sure?" (deletes, removals, discards). Never
 * window.confirm: this one is themed, explains what happens, keeps the
 * dialog open with the error when the action fails, and shows a spinner
 * while it runs.
 *
 *   const [confirmEl, confirm] = useConfirm();
 *   if (await confirm({ title: "Delete this note?", run: () => deleteNote(...) })) { ... }
 *
 * `run` returns an error message to keep the dialog open, or nothing.
 */

export interface ConfirmOptions {
  title: ReactNode;
  description?: ReactNode;
  /** Default "Delete". */
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "destructive" | "default";
  /** Runs on confirm, with the dialog showing a spinner. Return an error message to stay open. */
  run?: () => Promise<string | null | undefined | void>;
}

/** The solid red confirm button (the Button "destructive" variant is a light tint). */
export const DESTRUCTIVE_SOLID =
  "bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive/30";

export function ConfirmDialog({
  open,
  options,
  onClose,
}: {
  open: boolean;
  options: ConfirmOptions | null;
  /** true when confirmed (and `run` succeeded). */
  onClose: (confirmed: boolean) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tone = options?.tone ?? "destructive";

  async function confirm() {
    if (!options) return;
    setError(null);
    if (!options.run) {
      onClose(true);
      return;
    }
    setPending(true);
    try {
      const result = await options.run();
      if (typeof result === "string" && result) {
        setError(result);
        return;
      }
      onClose(true);
    } catch {
      setError("That didn't work. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) {
          setError(null);
          onClose(false);
        }
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-start gap-2.5">
            {tone === "destructive" && (
              <span className="bg-destructive/10 text-destructive -mt-0.5 grid size-7 shrink-0 place-items-center rounded-full">
                <TriangleAlert className="size-4" aria-hidden="true" />
              </span>
            )}
            <span className="pt-0.5">{options?.title}</span>
          </DialogTitle>
          {options?.description && <DialogDescription>{options.description}</DialogDescription>}
        </DialogHeader>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <DialogFooter>
          {/* Focus starts on Cancel, so Enter never deletes by accident. */}
          <Button
            type="button"
            variant="ghost"
            autoFocus
            disabled={pending}
            onClick={() => {
              setError(null);
              onClose(false);
            }}
          >
            {options?.cancelLabel ?? "Cancel"}
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={() => void confirm()}
            className={cn(tone === "destructive" && DESTRUCTIVE_SOLID)}
          >
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {options?.confirmLabel ?? "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A confirm dialog you can await: `[element, confirm]`. Render the element once. */
export function useConfirm(): [ReactNode, (options: ConfirmOptions) => Promise<boolean>] {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [open, setOpen] = useState(false);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((next: ConfirmOptions) => {
    resolver.current?.(false);
    setOptions(next);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const element = (
    <ConfirmDialog
      open={open}
      options={options}
      onClose={(confirmed) => {
        setOpen(false);
        resolver.current?.(confirmed);
        resolver.current = null;
      }}
    />
  );
  return [element, confirm];
}
