"use client";

import { createContext, useContext } from "react";

import type { MySidebar } from "@/lib/nav/my-sidebar";

/**
 * Your own arrangement of the sidebar (src/lib/nav/my-sidebar.ts) and the
 * Edit sidebar mode, shared by the shell (which keeps it in a cookie), the
 * sidebar's rows, and your menu (which opens the mode).
 */
export interface SidebarEdit {
  my: MySidebar;
  editing: boolean;
  /** Opens Edit sidebar (docking the sidebar first when it's on the rail). */
  startEditing: () => void;
  stopEditing: () => void;
  /** One group's rows, now in this order. */
  reorder: (groupIds: string[]) => void;
  /** Hides a row, or shows it again. */
  toggle: (id: string) => void;
  /** Back to the organization's sidebar. */
  reset: () => void;
}

const SidebarEditContext = createContext<SidebarEdit | null>(null);

export const SidebarEditProvider = SidebarEditContext.Provider;

/** The arrangement and its editing, or null outside the shell (the phone menu, tests). */
export function useSidebarEdit(): SidebarEdit | null {
  return useContext(SidebarEditContext);
}
