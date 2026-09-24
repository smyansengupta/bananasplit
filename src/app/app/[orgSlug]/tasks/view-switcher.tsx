"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";

import { TASK_VIEWS, TASKS_VIEW_COOKIE, type TaskView } from "./views";

function rememberView(view: TaskView): void {
  document.cookie = `${TASKS_VIEW_COOKIE}=${view}; path=/; max-age=31536000; samesite=lax`;
}

/**
 * The view tabs. The last view you pick is remembered in a cookie, so each
 * person lands on their own default (My Tasks, the Board, ...) next time.
 */
export function ViewSwitcher({ current, showIntake }: { current: TaskView; showIntake: boolean }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <nav aria-label="Task views" className="bg-muted inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-lg p-1">
      {TASK_VIEWS.filter((v) => v.value !== "intake" || showIntake).map((view) => {
        const params = new URLSearchParams();
        const project = searchParams.get("project");
        if (project) params.set("project", project);
        params.set("view", view.value);
        return (
          <Link
            key={view.value}
            href={`${pathname}?${params.toString()}`}
            onClick={() => rememberView(view.value)}
            aria-current={current === view.value ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
              current === view.value ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {view.label}
          </Link>
        );
      })}
    </nav>
  );
}
