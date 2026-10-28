"use client";

import {
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CheckSquare,
  Database,
  Eye,
  EyeOff,
  FolderOpen,
  GripVertical,
  LayoutDashboard,
  Loader2,
  Lock,
  Network,
  NotebookText,
  RotateCcw,
  Ticket,
  Users,
  Wallet,
  type IconComponent,
} from "@/components/icons";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toConfig, type GroupId, type ResolvedGroup, type ResolvedItem } from "@/lib/nav/sidebar";
import { cn } from "@/lib/utils";

import { saveSidebarAction } from "./actions";

const ICONS: Record<string, IconComponent> = {
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CheckSquare,
  Database,
  FolderOpen,
  LayoutDashboard,
  Network,
  NotebookText,
  Ticket,
  Users,
  Wallet,
};

/**
 * Settings › Sidebar: drag sections to reorder them or move them to another
 * heading, rename sections and headings, and hide what the club doesn't
 * use. A live preview shows the sidebar members will get.
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
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(toConfig(groups)) !== JSON.stringify(toConfig(initial));

  function updateItem(id: string, patch: Partial<ResolvedItem>) {
    setGroups((gs) =>
      gs.map((g) => ({ ...g, items: g.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) })),
    );
  }

  /** Moves `id` to `group`, in front of `beforeId` (or to the end). */
  function move(id: string, group: GroupId, beforeId: string | null) {
    setGroups((gs) => {
      const item = gs.flatMap((g) => g.items).find((i) => i.id === id);
      if (!item || item.locked) return gs;
      const without = gs.map((g) => ({ ...g, items: g.items.filter((i) => i.id !== id) }));
      return without.map((g) => {
        if (g.id !== group) return g;
        const at = beforeId ? g.items.findIndex((i) => i.id === beforeId) : g.items.length;
        const index = at < 0 ? g.items.length : at;
        // Overview stays first.
        const safe = g.items[index]?.locked ? index + 1 : index;
        return {
          ...g,
          items: [...g.items.slice(0, safe), { ...item, group }, ...g.items.slice(safe)],
        };
      });
    });
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

  function save(config: ReturnType<typeof toConfig> | null) {
    setStatus(null);
    start(async () => {
      const result = await saveSidebarAction(orgId, config);
      if (!result.ok) {
        setStatus({ ok: false, text: result.error ?? "Couldn't save." });
        return;
      }
      setStatus({
        ok: true,
        text: config ? "Sidebar saved for everyone." : "Back to the default sidebar.",
      });
      router.refresh();
    });
  }

  return (
    <div className="grid gap-7.5 xl:grid-cols-[minmax(0,1fr)_15rem]">
      <div className="space-y-4.5 max-md:min-w-0">
        {groups.map((group) => (
          <Card
            key={group.id}
            className="gap-2 px-3 py-3"
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
            <header className="flex items-center gap-2 px-2 pt-1">
              <Input
                value={group.label ?? ""}
                disabled={!canEdit}
                placeholder={group.id === "main" ? "No heading" : "Heading"}
                maxLength={24}
                onChange={(e) =>
                  setGroups((gs) =>
                    gs.map((g) =>
                      g.id === group.id ? { ...g, label: e.target.value || null } : g,
                    ),
                  )
                }
                aria-label="Heading"
                className="heading hover:bg-muted/60 h-10 max-w-64 border-transparent bg-transparent px-2 text-[15px] shadow-none"
              />
              <Badge variant="secondary" className="ms-auto">
                {group.items.length} section{group.items.length === 1 ? "" : "s"}
              </Badge>
            </header>
            <ul className="divide-border/70 divide-y">
              {group.items.length === 0 && (
                <li className="rounded-tile hatch bg-muted text-muted-foreground mx-1 px-4 py-3 text-sm">
                  Drag a section here.
                </li>
              )}
              {group.items.map((item) => {
                const Icon = ICONS[item.icon] ?? LayoutDashboard;
                return (
                  <li
                    key={item.id}
                    className={cn(
                      "rounded-field flex items-center gap-3 px-2 py-2 transition-colors",
                      item.hidden ? "bg-muted/40" : "hover:bg-muted/40",
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
                    {item.locked ? (
                      <span className="grid size-8 shrink-0 place-items-center">
                        <Lock className="text-muted-foreground size-4" aria-label="Always first" />
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
                    <span className="bg-card ring-foreground/6 grid size-9 shrink-0 place-items-center rounded-full shadow-[var(--edge-highlight)] ring-1">
                      <Icon className="size-[18px]" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <Input
                        value={item.label}
                        disabled={!canEdit}
                        maxLength={24}
                        onChange={(e) => updateItem(item.id, { label: e.target.value })}
                        onBlur={(e) => {
                          if (!e.target.value.trim())
                            updateItem(item.id, { label: item.defaultLabel });
                        }}
                        aria-label={`Name of ${item.defaultLabel}`}
                        className={cn(
                          "hover:bg-muted/60 h-8 border-transparent bg-transparent px-2 font-semibold shadow-none",
                          item.hidden && "text-muted-foreground line-through",
                        )}
                      />
                      <p className="text-muted-foreground truncate px-2 text-[13px]">
                        {item.label !== item.defaultLabel ? `${item.defaultLabel} · ` : ""}
                        {item.description}
                      </p>
                    </div>
                    {!item.locked && (
                      <Button
                        type="button"
                        variant={item.hidden ? "outline" : "ghost"}
                        size="sm"
                        disabled={!canEdit}
                        aria-pressed={!item.hidden}
                        onClick={() => updateItem(item.id, { hidden: !item.hidden })}
                      >
                        {item.hidden ? (
                          <EyeOff className="size-4" aria-hidden="true" />
                        ) : (
                          <Eye className="size-4" aria-hidden="true" />
                        )}
                        {item.hidden ? "Hidden" : "Shown"}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}

        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              disabled={pending || !dirty}
              onClick={() => save(toConfig(groups))}
            >
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              Save for everyone
            </Button>
            {dirty && (
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => setGroups(initial)}
              >
                Discard changes
              </Button>
            )}
            {customized && (
              <Button type="button" variant="ghost" disabled={pending} onClick={() => save(null)}>
                <RotateCcw className="size-4" aria-hidden="true" />
                Reset to default
              </Button>
            )}
            {status && (
              <span
                role="status"
                className={cn("text-sm", status.ok ? "text-success" : "text-destructive")}
              >
                {status.text}
              </span>
            )}
          </div>
        )}
      </div>

      <aside className="max-w-xs space-y-2 xl:sticky xl:top-20 xl:max-w-none xl:self-start">
        <p className="eyebrow text-muted-foreground px-1">Preview</p>
        <div className="bg-sidebar text-sidebar-foreground ring-foreground/6 edge rounded-card space-y-3 p-3 ring-1">
          {groups
            .map((g) => ({ ...g, items: g.items.filter((i) => !i.hidden) }))
            .filter((g) => g.items.length > 0)
            .map((g) => (
              <div key={g.id} className="space-y-0.5">
                {g.label && (
                  <p className="text-sidebar-foreground/60 px-2.5 pb-0.5 text-xs font-medium">
                    {g.label}
                  </p>
                )}
                {g.items.map((i) => {
                  const Icon = ICONS[i.icon] ?? LayoutDashboard;
                  return (
                    <p
                      key={i.id}
                      className="rounded-field flex items-center gap-2.5 px-2.5 py-1.5 text-sm"
                    >
                      <Icon className="size-4" aria-hidden="true" />
                      {i.label || i.defaultLabel}
                    </p>
                  );
                })}
              </div>
            ))}
        </div>
        <p className="text-muted-foreground px-1 text-[13px]">
          Hiding a section tidies the app for members; it doesn&apos;t delete anything. Owners and
          admins can still open it.
        </p>
      </aside>
    </div>
  );
}
