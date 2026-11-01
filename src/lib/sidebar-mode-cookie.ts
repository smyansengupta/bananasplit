import { cookies } from "next/headers";

import { mySidebarCookieName, parseMySidebar, type MySidebar } from "@/lib/nav/my-sidebar";
import { parseSidebarMode, sidebarCookieName, type SidebarMode } from "@/lib/sidebar-mode";

/**
 * The member's stored sidebar mode, read on the server so the shell renders
 * docked or rail from the first byte (src/lib/sidebar-mode.ts). The browser
 * writes the cookie; a missing or unexpected value is docked.
 */
export async function getSidebarMode(userId: string): Promise<SidebarMode> {
  const store = await cookies();
  return parseSidebarMode(store.get(sidebarCookieName(userId))?.value);
}

/**
 * Your own order and hidden rows for this organization's sidebar
 * (src/lib/nav/my-sidebar.ts), read on the server like the mode.
 */
export async function getMySidebar(userId: string, orgId: string): Promise<MySidebar> {
  const store = await cookies();
  return parseMySidebar(store.get(mySidebarCookieName(userId, orgId))?.value);
}
