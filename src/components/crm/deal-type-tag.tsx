import { CHOICE_COLOR_CLASS, type ChoiceColor } from "@/lib/databases/fields";
import { cn } from "@/lib/utils";

/** A deal's type as a small tag, in its choice's colour. */
export function TypeTag({ label, color, className }: { label: string; color: ChoiceColor; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 w-fit shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold",
        CHOICE_COLOR_CLASS[color],
        className,
      )}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current opacity-70" />
      {label}
    </span>
  );
}
