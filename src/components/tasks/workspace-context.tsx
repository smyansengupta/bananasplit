"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useMemo } from "react";

import {
  TASK_LAYOUTS,
  TASK_SCOPES,
  activeFilterCount,
  type TaskLayout,
  type TaskScope,
  type TaskView,
  type WorkspaceQuery,
} from "@/app/app/[orgSlug]/tasks/views";

/**
 * The workspace's shared state: which layout, whose work, which filters.
 *
 * It lives in the URL rather than in React state, which is what makes the
 * whole thing one product instead of five: every layout reads the same
 * query, a filtered view is a shareable link, and the browser's Back button
 * does the obvious thing. The last layout is also remembered in a cookie so
 * each person lands where they left off.
 */

interface WorkspaceValue {
  query: WorkspaceQuery;
  /** The layouts to offer: none on the Free plan, which has the List only. */
  layouts: readonly (typeof TASK_LAYOUTS)[number][];
  /** The Free plan's workspace: the List, no layouts or weekly update. */
  simple: boolean;
  scopes: readonly { value: TaskScope; label: string }[];
  filterCount: number;
  setView: (view: TaskView) => void;
  setScope: (scope: TaskScope) => void;
  setFilters: (next: Partial<WorkspaceQuery>) => void;
  /** Clears every filter `filterCount` counts (a person and due dates too); keeps the scope and project. */
  clearFilters: () => void;
  /** A href for the same workspace with these changes, for real links. */
  hrefWith: (next: Partial<WorkspaceQuery>) => string;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

const PARAM: Partial<Record<keyof WorkspaceQuery, string>> = {
  view: "view",
  scope: "scope",
  epicId: "epic",
  status: "status",
  ownerId: "owner",
  assigneeId: "assignee",
  labelId: "label",
  q: "q",
  dueFrom: "dueFrom",
  dueTo: "dueTo",
  flagged: "flagged",
  overdue: "overdue",
  blockers: "blockers",
  visibility: "visibility",
};

/** Params that belong to one layout and must not leak into another. */
const LAYOUT_LOCAL = ["page", "done", "position", "week", "person", "limit", "lanes"];

export function WorkspaceProvider({
  query,
  hasReports,
  simple = false,
  children,
}: {
  query: WorkspaceQuery;
  /** Whether "My team" means anything for this person. */
  hasReports: boolean;
  /** The Free plan: the List view only (src/lib/billing/features.ts). */
  simple?: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const write = useCallback(
    (next: Partial<WorkspaceQuery>, opts: { resetLayoutLocal?: boolean } = {}) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(next) as [keyof WorkspaceQuery, unknown][]) {
        const name = PARAM[key];
        if (!name) continue;
        if (value === undefined || value === null || value === false || value === "")
          params.delete(name);
        else params.set(name, value === true ? "1" : String(value));
      }
      // Paging, the board's "show older" and the team's position belong to
      // the layout you were in; changing the question starts them over.
      if (opts.resetLayoutLocal !== false) for (const p of LAYOUT_LOCAL) params.delete(p);
      return `${pathname}?${params.toString()}`;
    },
    [pathname, searchParams],
  );

  const value = useMemo<WorkspaceValue>(() => {
    const scopes = TASK_SCOPES.filter((s) => s.value !== "team" || hasReports);
    return {
      query,
      layouts: simple ? [] : TASK_LAYOUTS,
      simple,
      scopes,
      filterCount: activeFilterCount(query),
      hrefWith: (next) => write(next),
      setView: (view) => {
        router.push(write({ view }));
      },
      setScope: (scope) => {
        // Picking a scope replaces any person pinned by a deep link.
        router.push(write({ scope, ownerId: undefined, assigneeId: undefined }));
      },
      setFilters: (next) => router.push(write(next)),
      clearFilters: () =>
        router.push(
          write({
            status: undefined,
            ownerId: undefined,
            assigneeId: undefined,
            labelId: undefined,
            q: undefined,
            dueFrom: undefined,
            dueTo: undefined,
            flagged: false,
            overdue: false,
            blockers: false,
            visibility: undefined,
          }),
        ),
    };
  }, [query, hasReports, simple, router, write]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspaceState(): WorkspaceValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspaceState must be used inside <WorkspaceProvider>");
  return ctx;
}

export type { TaskLayout, TaskScope, TaskView, WorkspaceQuery };
