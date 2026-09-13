"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";

const VIEWS = [
  { value: "board", label: "Board" },
  { value: "table", label: "Table" },
  { value: "calendar", label: "Calendar" },
] as const;

export function ViewSwitcher() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentView = searchParams.get("view") ?? "board";

  return (
    <div className="bg-muted inline-flex items-center gap-1 rounded-lg p-1">
      {VIEWS.map((view) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("view", view.value);
        return (
          <Link
            key={view.value}
            href={`${pathname}?${params.toString()}`}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              currentView === view.value
                ? "bg-background shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {view.label}
          </Link>
        );
      })}
    </div>
  );
}
