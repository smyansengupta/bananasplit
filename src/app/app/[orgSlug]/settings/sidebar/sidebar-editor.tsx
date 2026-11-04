"use client";

import {
  CalendarDays,
  CheckSquare,
  ClipboardList,
  Database,
  FolderOpen,
  GripVertical,
  House,
  Inbox,
  LayoutDashboard,
  Lock,
  Plug,
  RotateCcw,
  Users,
  Video,
  Wallet,
  type IconComponent,
} from "@/components/icons";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { SavedMark, useSaveOnChange } from "@/components/ui/autosave";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toaster";
import {
  PINNED_PLACE,
  toConfig,
  type GroupId,
  type ResolvedGroup,
  type ResolvedItem,
  type SidebarConfig,
} from "@/lib/nav/sidebar";
import { cn } from "@/lib/utils";

import { saveSidebarAction } from "./actions";

const ICONS: Record<string, IconComponent> = {
  CalendarDays,
  CheckSquare,
  ClipboardList,
  Database,
  FolderOpen,
  House,
  Inbox,
  LayoutDashboard,
  Plug,
  Users,
  Video,
  Wallet,
};

/** How long a rename waits for the typing to stop before it saves. */
const TYPING_MS = 600;

/**
 * Admin panel › Sidebar: drag sections to reorder them (across the thin
 * lines between groups too), rename them, and switch off what the club
 * doesn't use. Every change saves on its own, and the real sidebar beside
 * this page is the preview: there is no Save button and no copy of it here.
 * Groups have no names to edit (the sidebar has none).
 */
export function SidebarEditor({
  orgId,
  initial,
  customized,
  canEdit,
}: {
  orgId: string;
  initial: ResolvedGroup[];
  customized: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [groups, setGroups] = useState(initial);
  const [dragId, setDragId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { status, error, save } = useSaveOnChange(async (config: SidebarConfig | null) => {
    const result = await saveSidebarAction(orgId, config);
    if (!result.ok) return result.error ?? "Couldn't save.";
    router.refresh();
  });

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  /** Shows the change at once and saves it (renames once the typing stops). */
  function commit(next: ResolvedGroup[], { typing = false } = {}) {
    setGroups(next);
    if (timer.current) clearTimeout(timer.current);
    const send = () => void save(toConfig(next));
    if (typing) timer.current = setTimeout(send, TYPING_MS);
    else send();
  }

  function updateItem(id: string, patch: Partial<ResolvedItem>, typing = false) {
    commit(
      groups.map((g) => ({
        ...g,
        items: g.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
      })),
      { typing },
    );
  }

  /** Moves `id` to `group`, in front of `beforeId` (or to the end). */
  function move(id: string, group: GroupId, beforeId: string | null) {
    const item = groups.flatMap((g) => g.items).find((i) => i.id === id);
    // Files and Integrations and apps keep their place (src/lib/nav/sidebar.ts).
    if (!item || item.locked || PINNED_PLACE.includes(item.id)) return;
    if (group === "workspace") return;
    const without = groups.map((g) => ({ ...g, items: g.items.filter((i) => i.id !== id) }));
    commit(
      without.map((g) => {
        if (g.id !== group) return g;
        const at = beforeId ? g.items.findIndex((i) => i.id === beforeId) : g.items.length;
        const index = at < 0 ? g.items.length : at;
        // Home and Inbox stay first.
        let safe = index;
        while (g.items[safe]?.locked) safe += 1;
        return {
          ...g,
          items: [...g.items.slice(0, safe), { ...item, group }, ...g.items.slice(safe)],
        };
      }),
    );
  }

  function nudge(id: string, by: number) {
    const all = groups.flatMap((g) => g.items.map((i) => ({ ...i, gid: g.id })));
    const at = all.findIndex((i) => i.id === id);
    const target = all[at + by];
    if (!target || target.locked) return;
    if (by < 0) move(id, target.gid, target.id);
    else {
      const after = all[at + by + 1];
      move(id, target.gid, after && after.gid === target.gid ? after.id : null);
    }
  }

  async function reset() {
    const before = groups;
    const ok = await save(null);
    if (!ok) return;
    toast({
      title: "Back to the default",
      action: {
        label: "Undo",
        run: async () => {
          const result = await saveSidebarAction(orgId, toConfig(before));
          if (!result.ok) return result.error ?? "Couldn't undo.";
          setGroups(before);
          router.refresh();
        },
      },
    });
  }

  return (
    <div className="max-w-2xl space-y-4">
      <Card className="gap-0 px-3 py-3">
        {groups.map((group, gi) => (
          <div
            key={group.id}
            className={cn(gi > 0 && "border-border/70 mt-2 border-t pt-2")}
            onDragOver={(e) => {
              if (dragId) e.preventDefault();
            }}
            onDrop={(e) => {
              if (!dragId) return;
              e.preventDefault();
              move(dragId, group.id, null);
              setDragId(null);
            }}
          >
            <ul>
              {group.items.length === 0 && (
                <li className="text-muted-foreground px-3 py-2 text-[13px]">Drop here</li>
              )}
              {group.items.map((item) => {
                const Icon = ICONS[item.icon] ?? LayoutDashboard;
                return (
                  <li
                    key={item.id}
                    className={cn(
                      "rounded-field flex items-center gap-3 px-2 py-1.5 transition-colors",
                      "hover:bg-muted/40",
                      dragId === item.id && "opacity-40",
                    )}
                    onDragOver={(e) => {
                      if (dragId) e.preventDefault();
                    }}
                    onDrop={(e) => {
                      if (!dragId) return;
                      e.preventDefault();
                      e.stopPropagation();
                      move(dragId, group.id, item.id);
                      setDragId(null);
                    }}
                  >
                    {item.locked || PINNED_PLACE.includes(item.id) ? (
                      <span className="grid size-8 shrink-0 place-items-center">
                        <Lock
                          className="text-muted-foreground size-4"
                          aria-label={item.locked ? "Always shown" : "Stays in its place"}
                        />
                      </span>
                    ) : (
                      <span
                        role="button"
                        tabIndex={0}
                        draggable={canEdit}
                        aria-label={`Move ${item.label}. Arrow keys move it up or down.`}
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/plain", item.id);
                          e.dataTransfer.effectAllowed = "move";
                          setDragId(item.id);
                        }}
                        onDragEnd={() => setDragId(null)}
                        onKeyDown={(e) => {
                          if (!canEdit) return;
                          if (e.key === "ArrowUp") {
                            e.preventDefault();
                            nudge(item.id, -1);
                          } else if (e.key === "ArrowDown") {
                            e.preventDefault();
                            nudge(item.id, 1);
                          }
                        }}
                        className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:outline-foreground grid size-8 shrink-0 cursor-grab place-items-center rounded-full outline-none focus-visible:outline-2 active:cursor-grabbing"
                      >
                        <GripVertical className="size-4" aria-hidden="true" />
                      </span>
                    )}
                    <span
                      className={cn(
                        "bg-card ring-foreground/6 grid size-9 shrink-0 place-items-center rounded-full shadow-[var(--edge-highlight)] ring-1",
                        item.hidden && "opacity-50",
                      )}
                    >
                      <Icon className="size-[18px]" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <Input
                        value={item.label}
                        disabled={!canEdit}
                        maxLength={24}
                        onChange={(e) => updateItem(item.id, { label: e.target.value }, true)}
                        onBlur={(e) => {
                          if (!e.target.value.trim())
                            updateItem(item.id, { label: item.defaultLabel });
                        }}
                        aria-label={`Name of ${item.defaultLabel}`}
                        className={cn(
                          "hover:bg-muted/60 h-8 border-transparent bg-transparent px-2 font-semibold shadow-none",
                          item.hidden && "text-muted-foreground",
                        )}
                      />
                      {item.label !== item.defaultLabel && (
                        <p className="text-muted-foreground px-2 text-[13px]">
                          Was {item.defaultLabel}
                        </p>
                      )}
                    </div>
                    {!item.locked && (
                      <Switch
                        checked={!item.hidden}
                        disabled={!canEdit}
                        onCheckedChange={(on) => updateItem(item.id, { hidden: !on })}
                        aria-label={`Show ${item.label}`}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </Card>

      <div className="flex flex-wrap items-center gap-3 px-1">
        {canEdit && customized && (
          <Button type="button" variant="ghost" onClick={() => void reset()}>
            <RotateCcw className="size-4" aria-hidden="true" />
            Reset to default
          </Button>
        )}
        <SavedMark status={status} error={error} />
        <p className="text-muted-foreground text-[13px]">
          Hidden sections stay open to owners and admins.
        </p>
      </div>
    </div>
  );
}
