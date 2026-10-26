import * as React from "react";
import { cn } from "cn";

import { DateInput, THEMED_INPUT_TYPES } from "@/components/ui/date-field";

/**
 * A text field, and — for a date, a date and time, or a time — the themed
 * picker instead of the operating system's own. Those three native controls
 * draw the Windows calendar and Chrome's clock, the one place in the app
 * where the theme stopped at the edge of the field. DateInput takes the same
 * props and gives `onChange` the same shape, so a field swaps over without
 * its call site changing.
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  if (type && THEMED_INPUT_TYPES.has(type)) {
    return <DateInput type={type} className={className} {...props} />;
  }
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "border-input file:text-foreground placeholder:text-muted-foreground focus-visible:border-foreground disabled:bg-input/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 rounded-field bg-card h-10 w-full min-w-0 border px-3.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:shadow-[0_0_0_4px_color-mix(in_oklab,var(--glow)_45%,transparent)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-3 md:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
