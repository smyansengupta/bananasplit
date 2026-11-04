"use client";

import { useId, useRef, type ComponentProps, type ReactNode } from "react";
import { cn } from "cn";

import type { IconComponent } from "@/components/icons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHead,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

/**
 * The create dialogs' shared pieces: New task's window (a fixed header with
 * the black Close, a body that scrolls, a fixed foot with the buttons), its
 * labelled fields in one column with pairs side by side, and New event's
 * kind cards. New task, New event and the CRM's New person, New company,
 * New deal and email plans are built from these, so they read as one.
 */

/**
 * On a phone, a popup fills the screen: full height, no margin round it,
 * rounded at the top only (Tasks' task dialog keeps its margins; the CRM's
 * cards, the create dialogs and Calendar's event detail don't). Put it on
 * a DialogContent after its own size classes.
 */
export const PHONE_FULL_SCREEN =
  "max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-dvh max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-t-card max-sm:rounded-b-none max-sm:pb-[env(safe-area-inset-bottom)]";

/** New task's window: 672px wide, as tall as it needs up to the screen; the whole screen on a phone. */
export function FormDialog({
  open,
  onOpenChange,
  className,
  onInteractOutside,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className?: string;
  onInteractOutside?: ComponentProps<typeof DialogContent>["onInteractOutside"];
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "flex max-h-[min(94vh,880px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl",
          PHONE_FULL_SCREEN,
          className,
        )}
        onInteractOutside={onInteractOutside}
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}

/** A toast's Undo or Open sits outside the dialog: clicking it mustn't close the dialog. */
export function keepOpenForToasts(e: { target: EventTarget | null; preventDefault: () => void }) {
  if (e.target instanceof Element && e.target.closest("[data-toaster]")) e.preventDefault();
}

/**
 * The title, the quiet line under it, and the black Close in the corner.
 * `children` sit under the line (a small switch, never a field).
 */
export function FormDialogHead({
  title,
  description,
  className,
  children,
}: {
  title: ReactNode;
  description: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <DialogHead
      className={cn("shrink-0 ps-6 pe-4 pt-4 pb-2", className)}
      title={title}
      subtitle={<DialogDescription>{description}</DialogDescription>}
    >
      {children}
    </DialogHead>
  );
}

/** The part that scrolls: one column of fields. */
export function FormDialogBody({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-0 flex-1 [scrollbar-width:thin] overflow-x-hidden overflow-y-auto overscroll-contain">
      <div className={cn("flex flex-col gap-4 px-6 pt-2 pb-5", className)}>{children}</div>
    </div>
  );
}

/** The fixed foot: the buttons, the main one last (on a phone, on top). */
export function FormDialogFoot({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <DialogFooter className={cn("m-0 shrink-0 border-t px-6 py-4", className)}>
      {children}
    </DialogFooter>
  );
}

/**
 * A labelled field. With `htmlFor` the label is a real <label>; without it
 * (a group of buttons) it's a plain line, and `labelId` names the group.
 */
export function FormField({
  label,
  htmlFor,
  labelId,
  hint,
  className,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  labelId?: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      {htmlFor ? (
        <Label htmlFor={htmlFor}>{label}</Label>
      ) : (
        <span id={labelId} className="text-sm leading-none font-medium">
          {label}
        </span>
      )}
      {children}
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}

/** Two fields side by side (one above the other on a phone). */
export function FormRow({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2 [&>*]:min-w-0", className)}>
      {children}
    </div>
  );
}

/** Errors under the fields, read out as they appear. */
export function FormError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p className="text-destructive text-sm" role="alert">
      {children}
    </p>
  );
}

export interface ChoiceCard<T extends string> {
  value: T;
  label: string;
  hint: string;
  icon: IconComponent;
}

/**
 * New event's kind cards: a few cards, one chosen, a radio group's
 * keyboard. Tab reaches the chosen card only, and the arrow keys move the
 * choice (and focus) to the next or the one before, wrapping round.
 */
export function ChoiceCards<T extends string>({
  label,
  options,
  value,
  onChange,
  className = "grid grid-cols-1 gap-2 sm:grid-cols-3",
}: {
  label: string;
  options: readonly ChoiceCard<T>[];
  value: T;
  onChange: (next: T) => void;
  className?: string;
}) {
  const id = useId();
  const cards = useRef<Partial<Record<T, HTMLButtonElement | null>>>({});

  function onKeyDown(keyEvent: React.KeyboardEvent, index: number) {
    if (keyEvent.altKey || keyEvent.ctrlKey || keyEvent.metaKey) return;
    const step =
      keyEvent.key === "ArrowRight" || keyEvent.key === "ArrowDown"
        ? 1
        : keyEvent.key === "ArrowLeft" || keyEvent.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;
    keyEvent.preventDefault();
    const next = options[(index + step + options.length) % options.length]!.value;
    onChange(next);
    cards.current[next]?.focus();
  }

  return (
    <div role="radiogroup" aria-label={label} className={className}>
      {options.map((option, index) => {
        const selected = option.value === value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            ref={(node) => {
              cards.current[option.value] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-labelledby={`${id}-${option.value}-label`}
            aria-describedby={`${id}-${option.value}-hint`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(keyEvent) => onKeyDown(keyEvent, index)}
            className={cn(
              "focus-visible:outline-foreground flex min-w-0 flex-col gap-1 rounded-lg border p-3 text-left transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2",
              selected ? "border-primary bg-primary/5" : "hover:bg-muted/50",
            )}
          >
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <Icon aria-hidden className="text-muted-foreground size-4 shrink-0" />
              <span id={`${id}-${option.value}-label`}>{option.label}</span>
            </span>
            <span
              id={`${id}-${option.value}-hint`}
              className="text-muted-foreground text-xs leading-snug"
            >
              {option.hint}
            </span>
          </button>
        );
      })}
    </div>
  );
}
