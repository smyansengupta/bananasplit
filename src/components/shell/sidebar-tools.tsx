"use client";

import { Plus, Search } from "@/components/icons";

import { useModKey } from "@/components/command-palette/use-mod-key";
import { CreateMenu } from "@/components/shell/create-menu";
import type { CreateAction } from "@/components/shell/nav-config";
import { ICON_STROKE } from "@/components/shell/sidebar-nav";
import { fadeLabel, useSidebarMode } from "@/components/shell/sidebar-mode-context";
import { cn } from "@/lib/utils";

/**
 * The top of the sidebar under the organization menu (the plan's "Option A,
 * revised"): a "Search or jump" field that opens the Ctrl K palette, and one
 * full-width New button that makes anything. On the rail both become round
 * icon buttons in the same places, so collapsing only changes the width.
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
    <div className="flex shrink-0 flex-col gap-1 pb-2">
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
          "focus-glow flex h-8 shrink-0 items-center gap-2 overflow-hidden rounded-lg border px-2 text-[13px] outline-none",
          "[transition:width_500ms_var(--ease-ink),background-color_200ms] motion-reduce:[transition:none]",
          chrome
            ? "border-chrome-foreground/15 bg-chrome-foreground/6 text-chrome-foreground/60 hover:bg-chrome-foreground/10"
            : "bg-card text-muted-foreground hover:text-foreground border-border",
          rail ? "w-8 justify-center px-0" : "w-full",
        )}
      >
        <Search className="size-3.5 shrink-0" strokeWidth={ICON_STROKE} aria-hidden="true" />
        <span className={cn("min-w-0 flex-1 truncate text-left", fadeLabel(rail))}>
          Search or jump
        </span>
        <kbd
          className={cn(
            "rounded border px-1 font-mono text-[10.5px] leading-4",
            chrome ? "border-chrome-foreground/15" : "border-border",
            fadeLabel(rail),
          )}
        >
          {mod === "⌘" ? "⌘K" : "Ctrl K"}
        </kbd>
      </button>
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
                "focus-glow mb-1 flex h-8 shrink-0 items-center gap-2 overflow-hidden rounded-lg px-2 text-[13.5px] font-semibold outline-none",
                "[transition:width_500ms_var(--ease-ink),opacity_200ms] motion-reduce:[transition:none]",
                "bg-primary text-primary-foreground hover:opacity-90",
                rail ? "w-8 justify-center px-0" : "w-full",
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
    </div>
  );
}
