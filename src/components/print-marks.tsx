import { cn } from "@/lib/utils";

/**
 * Printer's marks for the "Riso bulletin" look (globals.css). Decorative
 * only: hidden from assistive tech, and drawn in the theme's own tokens.
 */

/** The target a printer lines each ink pass up against. */
export function RegistrationMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      className={cn("text-muted-foreground/70 size-5", className)}
    >
      <circle cx="12" cy="12" r="6.5" />
      <path d="M12 0.5v23M0.5 12h23" />
    </svg>
  );
}

/**
 * "Bananasplit", split: the display face at full width and weight, the
 * second half set off on its own line, and the accent ink printed out of
 * register. On load the halves come apart and the second ink slides into
 * place (motion-safe only). Size it with a font-size class.
 */
export function SplitWordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "font-heading block leading-[0.8] font-black tracking-[-0.045em] font-stretch-[150%]",
        className,
      )}
    >
      <span className="sr-only">Bananasplit</span>
      <span
        aria-hidden="true"
        className="misregister block motion-safe:animate-[ink-register_1.1s_var(--ease-ink)_0.2s_backwards]"
      >
        Banana
      </span>
      <span
        aria-hidden="true"
        className="misregister block pl-[0.9em] motion-safe:animate-[split-off_0.9s_var(--ease-ink)_0.1s_backwards,ink-register_1.1s_var(--ease-ink)_0.35s_backwards]"
      >
        split
      </span>
    </span>
  );
}
