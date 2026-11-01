"use client";

import { Plus, Search } from "@/components/icons";

import { useModKey } from "@/components/command-palette/use-mod-key";
import { CreateMenu } from "@/components/shell/create-menu";
import type { CreateAction } from "@/components/shell/nav-config";
import { ICON_STROKE } from "@/components/shell/sidebar-nav";
import { fadeLabel, useSidebarMode } from "@/components/shell/sidebar-mode-context";
import { cn } from "@/lib/utils";

/**
 * The top of the sidebar under the organization menu: one full-width New
 * button that makes anything, and under it a "Search or jump" field that
 * opens the Ctrl K palette. On the rail both become 40px round icon
 * buttons in the same places, their labels running off to the right.
 * They live here, not in the top-right capsule: one place to search, one
 * place to create.
 */
export function SidebarTools({
  orgId,
  orgSlug,
  createActions,
  onSearch,
  onNavigate,
}: {
  orgId: string;
  orgSlug: string;
  createActions: readonly CreateAction[];
  onSearch: () => void;
  onNavigate?: () => void;
}) {
  const { rail, chrome } = useSidebarMode();
  const mod = useModKey();
  return (
    <div className="flex shrink-0 flex-col gap-1.5 pb-4">
      {createActions.length > 0 && (
        <CreateMenu
          orgId={orgId}
          orgSlug={orgSlug}
          actions={createActions}
          side="bottom"
          align="start"
        >
          {({ pending, icon }) => (
            <button
              type="button"
              aria-label="New"
              aria-keyshortcuts="c"
              data-new-button=""
              title={rail ? "New (c)" : undefined}
              aria-busy={pending || undefined}
              className={cn(
                // The plan's New: one dark, full-width button.
                "focus-glow flex shrink-0 items-center overflow-hidden text-[14.5px] font-semibold outline-none",
                "[transition:width_500ms_var(--ease-ink),height_500ms_var(--ease-ink),border-radius_500ms_var(--ease-ink),padding_500ms_var(--ease-ink),opacity_200ms] motion-reduce:[transition:none]",
                "bg-primary text-primary-foreground hover:opacity-90",
                // On the rail: a 40px circle, the plus at its centre.
                rail ? "size-10 gap-0 rounded-[20px] px-3" : "h-8 w-full gap-2 rounded-lg px-2",
              )}
            >
              <span className="grid size-4 shrink-0 place-items-center">
                {pending ? (
                  icon
                ) : (
                  <Plus className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                )}
              </span>
              <span className={cn("min-w-0 truncate", fadeLabel(rail))}>New</span>
            </button>
          )}
        </CreateMenu>
      )}
      <button
        type="button"
        onClick={() => {
          onNavigate?.();
          onSearch();
        }}
        aria-label="Search or jump"
        aria-keyshortcuts="Meta+K Control+K"
        title={rail ? "Search or jump" : undefined}
        className={cn(
          // The plan's search field: bordered, on the card colour, quiet text.
          "focus-glow flex shrink-0 items-center overflow-hidden border text-[14px] outline-none",
          "[transition:width_500ms_var(--ease-ink),height_500ms_var(--ease-ink),border-radius_500ms_var(--ease-ink),padding_500ms_var(--ease-ink),background-color_200ms] motion-reduce:[transition:none]",
          chrome
            ? "border-chrome-foreground/15 bg-chrome-foreground/6 text-chrome-foreground/60 hover:bg-chrome-foreground/10"
            : "bg-card text-muted-foreground hover:text-foreground border-border",
          // On the rail: a 40px circle, the glass inside the border at its centre.
          rail ? "size-10 gap-0 rounded-[20px] px-[11px]" : "h-8 w-full gap-2 rounded-lg px-2",
        )}
      >
        <Search className="size-4 shrink-0" strokeWidth={ICON_STROKE} aria-hidden="true" />
        <span className={cn("min-w-0 flex-1 truncate text-left", fadeLabel(rail))}>
          Search or jump
        </span>
        <kbd
          className={cn(
            "shrink-0 rounded border px-1 font-mono text-[11px] leading-4",
            chrome ? "border-chrome-foreground/15" : "border-border",
            fadeLabel(rail),
          )}
        >
          {mod === "⌘" ? "⌘K" : "Ctrl K"}
        </kbd>
      </button>
    </div>
  );
}
