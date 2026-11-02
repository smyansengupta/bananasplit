"use client";

/**
 * The phone's one piece of floating chrome: a glass circle at the top left
 * holding the menu button (NavMenu), which opens the organization, you,
 * search, New and every section, full screen. From md up there is no top
 * bar at all: everything it held lives in the sidebar (search and New at the
 * top, the pin beside the pins, you at the foot), so every page starts at
 * the top of the window.
 *
 * It floats: its row is sticky and lets clicks through everywhere but the
 * circle.
 */
export function ToolCapsule({
  menuButton,
}: {
  /** The phone's menu button (NavMenu). */
  menuButton?: React.ReactNode;
}) {
  return (
    <div
      data-tool-capsule=""
      className="pointer-events-none sticky top-0 z-30 flex pt-[max(0.75rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] md:hidden"
    >
      <div
        role="toolbar"
        aria-label="Tools"
        className="glass-light pointer-events-auto flex items-center rounded-full p-1"
      >
        {menuButton}
      </div>
    </div>
  );
}
