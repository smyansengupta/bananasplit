"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect } from "react";

import { Eye, EyeOff, FileText, GripVertical, RotateCcw } from "@/components/icons";
import type { NavLink, NavSection } from "@/components/shell/nav-config";
import { useSidebarEdit } from "@/components/shell/sidebar-edit-context";
import { surfaceTone, useSidebarMode } from "@/components/shell/sidebar-mode-context";
import { GroupLabel, ICON_STROKE, NAV_ICONS, SECTION_NAMES } from "@/components/shell/sidebar-nav";
import { ALWAYS_SHOWN } from "@/lib/nav/my-sidebar";
import { overlayOpen } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

/**
 * Edit sidebar's header, in place of New and Search: what the mode does,
 * Reset when you've changed something, and Done. Esc is Done too.
 */
export function SidebarEditHeader() {
  const edit = useSidebarEdit();
  const { chrome } = useSidebarMode();
  const tone = surfaceTone(chrome);
  const stop = edit?.stopEditing;

  useEffect(() => {
    if (!stop) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented || overlayOpen()) return;
      stop?.();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [stop]);

  if (!edit) return null;
  const changed = edit.my.order.length > 0 || edit.my.hidden.length > 0;
  return (
    <div className="flex shrink-0 flex-col gap-1 pb-2">
      <div className="flex items-center gap-1.5 pl-2">
        <span className="flex-1 text-[13.5px] font-semibold">Edit sidebar</span>
        {changed && (
          <button
            type="button"
            onClick={edit.reset}
            title="Back to your organization's sidebar"
            className={cn(
              "focus-glow flex h-7 items-center gap-1 rounded-[7px] px-2 text-xs font-medium outline-none",
              tone.text,
              tone.hover,
            )}
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />
            Reset
          </button>
        )}
        <button
          type="button"
          onClick={edit.stopEditing}
          className={cn(
            "focus-glow h-7 rounded-[7px] px-3 text-xs font-semibold outline-none active:scale-[0.97]",
            chrome
              ? "bg-chrome-accent text-chrome-accent-foreground"
              : "bg-brand-accent text-brand-accent-foreground",
          )}
        >
          Done
        </button>
      </div>
      <p className={cn("px-2 text-xs", tone.quiet)}>
        Drag to reorder. Hidden pages stay in Search.
      </p>
    </div>
  );
}

function EditRow({ link }: { link: NavLink }) {
  const edit = useSidebarEdit();
  const { chrome } = useSidebarMode();
  const tone = surfaceTone(chrome);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: link.id,
  });
  const hidden = edit?.my.hidden.includes(link.id) ?? false;
  const fixed = ALWAYS_SHOWN.has(link.id);
  const Icon = NAV_ICONS[link.icon] ?? FileText;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "bg-background/70 border-border/70 relative flex h-8 items-center gap-2 rounded-[7px] border pr-1 text-[13.5px] font-medium",
        isDragging && "z-10 shadow-md",
        hidden && "opacity-50",
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Move ${link.label}`}
        className={cn(
          "focus-glow grid h-full w-6 shrink-0 cursor-grab touch-none place-items-center rounded-l-[7px] outline-none active:cursor-grabbing",
          tone.quiet,
        )}
      >
        <GripVertical className="size-3.5" aria-hidden="true" />
      </button>
      <Icon className="size-4 shrink-0 opacity-70" strokeWidth={ICON_STROKE} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{link.label}</span>
      {!fixed && (
        <button
          type="button"
          onClick={() => edit?.toggle(link.id)}
          aria-pressed={!hidden}
          aria-label={hidden ? `Show ${link.label}` : `Hide ${link.label}`}
          title={hidden ? "Show" : "Hide"}
          className={cn(
            "focus-glow grid size-6 shrink-0 place-items-center rounded-md outline-none",
            tone.text,
            tone.hover,
          )}
        >
          {hidden ? (
            <EyeOff className="size-3.5" aria-hidden="true" />
          ) : (
            <Eye className="size-3.5" aria-hidden="true" />
          )}
        </button>
      )}
    </li>
  );
}

function EditGroup({ section }: { section: NavSection }) {
  const edit = useSidebarEdit();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = section.items.map((i) => i.id);
  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    edit?.reorder(arrayMove(ids, from, to));
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className="flex flex-col gap-1">
          {section.items.map((link) => (
            <EditRow key={link.id} link={link} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

/** Every row, hidden ones too, each group sortable on its own. */
export function SidebarEditRows({ sections }: { sections: NavSection[] }) {
  return (
    <>
      {sections.map((section) => (
        <div key={section.id} className="flex flex-col">
          {(section.label ?? SECTION_NAMES[section.id]) && (
            <GroupLabel label={(section.label ?? SECTION_NAMES[section.id])!} />
          )}
          <EditGroup section={section} />
        </div>
      ))}
    </>
  );
}
