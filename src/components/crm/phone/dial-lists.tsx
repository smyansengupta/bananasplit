"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { chipClass } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";

/**
 * Which list the dialer works down, in its card (?open=calls): the calls
 * and follow-ups due, or one of the organization's lists (`?dial=<id>`).
 * The card stays open over the page you're on.
 */
export function DialLists({
  lists,
  picked,
}: {
  lists: readonly { id: string; name: string }[];
  picked: string | null;
}) {
  const pathname = usePathname() ?? "";
  const params = useSearchParams();
  const hrefFor = (id: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (id) next.set("dial", id);
    else next.delete("dial");
    return `${pathname}?${next.toString()}`;
  };
  const all = [{ id: null, name: "Calls and follow-ups due" }, ...lists];
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Who to call">
      {all.map((l) => {
        const on = l.id === picked;
        return (
          <Link
            key={l.id ?? "due"}
            href={hrefFor(l.id)}
            replace
            scroll={false}
            aria-current={on ? "true" : undefined}
            className={cn(chipClass(on), "h-8 px-3 text-[13px]")}
          >
            {l.name}
          </Link>
        );
      })}
    </div>
  );
}
