"use client";

import * as React from "react";
import { cn } from "cn";
import { Dialog as DialogPrimitive } from "radix-ui";

import { Button } from "@/components/ui/button";
import { XIcon } from "@/components/icons";

function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

/**
 * How a popup comes and goes: `full` fades in and out; `in` fades in and
 * goes at once; `none` does neither. Two popups that take each other's
 * place use `none`, so nothing fades over anything else.
 */
export type DialogMotion = "full" | "in" | "none";

function DialogOverlay({
  className,
  motion = "full",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay> & { motion?: DialogMotion }) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/30 duration-150 supports-backdrop-filter:backdrop-blur-[2px]",
        motion !== "none" && "data-open:animate-in data-open:fade-in-0",
        motion === "full" && "data-closed:animate-out data-closed:fade-out-0",
        className,
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  motion = "full",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
  motion?: DialogMotion;
}) {
  return (
    <DialogPortal>
      <DialogOverlay motion={motion} />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "bg-popover text-popover-foreground ring-foreground/6 shadow-e2 rounded-card fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 p-6 text-sm ring-1 duration-100 outline-none sm:max-w-sm",
          motion !== "none" && "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
          motion === "full" && "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          // Keep a header's text clear of the round Close in the corner.
          showCloseButton && "[&_[data-slot=dialog-header]]:pe-8",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && <DialogCloseButton className="absolute top-4 right-4" />}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

/**
 * Every popup's Close: a round black button (the foreground colour with the
 * icon in the background colour), 16px in from the top-right corner. With
 * `onClick` it runs that instead of closing through the dialog (a card that
 * removes `?open=` from the URL, an editor's own onDone).
 */
function DialogCloseButton({
  className,
  onClick,
  label = "Close",
}: {
  className?: string;
  onClick?: () => void;
  label?: string;
}) {
  const button = (
    <button
      type="button"
      data-slot="dialog-close-button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "bg-foreground text-background focus-visible:outline-foreground inline-grid size-9 shrink-0 place-items-center rounded-full transition-[background-color,transform] duration-150 outline-none hover:bg-[color-mix(in_oklab,var(--foreground)_80%,var(--background))] focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-[0.94]",
        className,
      )}
    >
      <XIcon className="size-4" aria-hidden="true" />
    </button>
  );
  if (onClick) return button;
  return (
    <DialogPrimitive.Close data-slot="dialog-close" asChild>
      {button}
    </DialogPrimitive.Close>
  );
}

/**
 * The header of a centred popup (a CRM card, a task, New task, New event,
 * an integration): the title on the left, with an optional mark before it
 * and a quiet line under it; on the right the black Close, and the popup's
 * other round buttons (Call, "…", Pin) in a row right under it. Use it with
 * `showCloseButton={false}` on DialogContent, since it draws the Close. Pad
 * its container `pt-4 pe-4` so the Close sits where every other popup's does.
 */
function DialogHead({
  title,
  subtitle,
  leading,
  actions,
  onClose,
  plainTitle = false,
  className,
  titleClassName,
  children,
}: {
  title: React.ReactNode;
  /** One quiet line under the title (pass a DialogDescription to describe the popup). */
  subtitle?: React.ReactNode;
  /** A mark before the title (an avatar, a type chip). */
  leading?: React.ReactNode;
  /** Round buttons that sit right under the Close, right-aligned. */
  actions?: React.ReactNode;
  /** Instead of closing through the dialog. */
  onClose?: () => void;
  /** The title is already a DialogTitle elsewhere: render it as given. */
  plainTitle?: boolean;
  className?: string;
  titleClassName?: string;
  /** More on the left, under the title and subtitle. */
  children?: React.ReactNode;
}) {
  return (
    <div data-slot="dialog-head" className={cn("flex items-start gap-3", className)}>
      {leading && <div className="flex min-h-9 shrink-0 items-center">{leading}</div>}
      <div className="flex min-h-9 min-w-0 flex-1 flex-col justify-center">
        {plainTitle ? (
          title
        ) : (
          <DialogTitle className={cn("heading text-lg leading-tight", titleClassName)}>
            {title}
          </DialogTitle>
        )}
        {subtitle && <div className="text-muted-foreground pt-1 text-sm">{subtitle}</div>}
        {children}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <DialogCloseButton onClick={onClose} />
        {actions && (
          // Round buttons match the Close (36px), whatever size they came in.
          <div className="flex max-w-[8.25rem] flex-wrap items-center justify-end gap-1.5 [&_[data-size^=icon]]:size-9">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="dialog-header" className={cn("flex flex-col gap-2", className)} {...props} />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "rounded-b-card -mx-6 -mb-6 flex flex-col-reverse gap-2 px-6 pt-2 pb-6 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("heading text-lg leading-tight", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-muted-foreground *:[a]:hover:text-foreground text-sm *:[a]:underline *:[a]:underline-offset-3",
        className,
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHead,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
