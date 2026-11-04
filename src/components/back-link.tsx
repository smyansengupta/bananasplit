import { ArrowLeft } from "@/components/icons";
import Link from "next/link";

/**
 * The way back up from a detail page (a task, an event, a poll, a file, a
 * database), above its title: a circle ← with the parent's name beside it,
 * the same on every page.
 */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="group/back text-muted-foreground hover:text-foreground focus-glow inline-flex items-center gap-2 rounded-full pr-2 text-sm font-medium transition-colors"
    >
      <span className="border-input group-hover/back:bg-muted grid size-8 place-items-center rounded-full border transition-[background-color,transform] group-active/back:scale-[0.94]">
        <ArrowLeft className="size-4" aria-hidden="true" />
      </span>
      {label}
    </Link>
  );
}
