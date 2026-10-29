import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

import { pill } from "./pill";

/*
 * Form controls for Bananasplit's own pages (sign-in, sign-up, password
 * help, joining a club): Moonstone's 40px fields (44 on touch screens) with
 * 14px corners and the glow focus ring, and the submit pill. 16px type on
 * phones, so iOS doesn't zoom into a field.
 */

export const brandInputClass =
  "bg-card text-foreground border-input focus-banana rounded-field h-10 w-full min-w-0 border px-3.5 text-base outline-none transition-[border-color,box-shadow] aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/15 sm:text-[15px] pointer-coarse:h-11";

/**
 * A field whose label sits inside it: the input's placeholder says what it
 * is (callers pass the label as the placeholder) and the label is kept for
 * screen readers. Fewer words on the page. `aside` (Forgot?, a status)
 * sits under the field on the right.
 */
export function BrandField({
  id,
  label,
  aside,
  children,
  className,
}: {
  id: string;
  label: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      {children}
      {aside && <div className="flex justify-end text-[13px]">{aside}</div>}
    </div>
  );
}

export function BrandInput({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(brandInputClass, className)} {...props} />;
}

/** A form's submit: the 40px primary pill, full width. */
export function PrimaryButton({ className, ...props }: ComponentProps<"button">) {
  return <button className={cn(pill(), "w-full", className)} {...props} />;
}

/** The "or" between the Google button and the email form. */
export function OrDivider() {
  return (
    <div className="text-muted-foreground flex items-center gap-3.5 text-[13px]">
      <span className="bg-border h-px flex-1" />
      or
      <span className="bg-border h-px flex-1" />
    </div>
  );
}

/** A form-level message: an error (a refused sign-in, a taken email) or a note (a changed password). */
export function FormMessage({
  children,
  tone = "error",
}: {
  children: ReactNode;
  tone?: "error" | "info";
}) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-field m-0 px-3.5 py-2.5 text-[14px] leading-[1.45]",
        tone === "error"
          ? "bg-tint-danger text-tint-danger-foreground"
          : "bg-tint-info text-tint-info-foreground",
      )}
    >
      {children}
    </p>
  );
}
