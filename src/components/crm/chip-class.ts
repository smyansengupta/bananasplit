import { cn } from "@/lib/utils";

/**
 * chipClass from @/components/ui/segmented for server components (that
 * module is a client one, so a server page can't call its functions). Keep
 * the two in step.
 */
export function serverChipClass(active: boolean) {
  return cn(
    "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground [&_svg]:size-4",
    active ? "bg-primary text-primary-foreground border-transparent" : "border-input text-foreground hover:bg-muted",
  );
}
