"use client";

import type { IconComponent } from "@/components/icons";
import { ReactRenderer } from "@tiptap/react";
import type { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

/**
 * The editor's pop-up menus (the slash menu, @ people and dates, [[ pages):
 * a raised menu of 40px rows, grouped under small headings, driven from the
 * keyboard (arrows, Enter, Escape) while you keep typing in the note.
 */

export interface MenuItem {
  key: string;
  title: string;
  description?: string;
  icon?: IconComponent;
  /** Shown instead of the icon (an avatar, an emoji). */
  leading?: ReactNode;
  /** The heading this item sits under ("Basic blocks", "People"...). */
  group?: string;
  hint?: string;
}

interface MenuProps<T extends MenuItem> {
  items: T[];
  command: (item: T) => void;
  empty?: string;
  label: string;
}

export interface SuggestionMenuHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

function MenuInner<T extends MenuItem>(
  { items, command, empty = "Nothing matches", label }: MenuProps<T>,
  ref: React.Ref<SuggestionMenuHandle>,
) {
  const [selected, setSelected] = useState(0);
  const [shownItems, setShownItems] = useState(items);
  const list = useRef<HTMLDivElement>(null);
  // A new query starts at the top.
  if (shownItems !== items) {
    setShownItems(items);
    setSelected(0);
  }
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (items.length === 0) return false;
      if (event.key === "ArrowDown") {
        setSelected((i) => (i + 1) % items.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        setSelected((i) => (i - 1 + items.length) % items.length);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const item = items[selected];
        if (item) command(item);
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) {
    return (
      <div className="bg-popover text-muted-foreground shadow-e2 rounded-tile w-72 border p-3 text-sm">
        {empty}
      </div>
    );
  }

  return (
    <div
      ref={list}
      role="listbox"
      aria-label={label}
      className="bg-popover text-popover-foreground shadow-e2 rounded-tile max-h-80 w-72 overflow-y-auto border p-1.5"
    >
      {items.map((item, index) => {
        const heading = item.group && item.group !== items[index - 1]?.group ? item.group : null;
        const Icon = item.icon;
        return (
          <div key={item.key}>
            {heading && (
              <p className="eyebrow text-muted-foreground px-2.5 pt-2 pb-1 text-xs">{heading}</p>
            )}
            <button
              type="button"
              role="option"
              aria-selected={index === selected}
              data-index={index}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => command(item)}
              onMouseEnter={() => setSelected(index)}
              className={cn(
                "flex min-h-10 w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-sm",
                index === selected ? "bg-muted" : "hover:bg-muted/60",
              )}
            >
              {item.leading ??
                (Icon && (
                  <span className="bg-muted text-muted-foreground grid size-7 shrink-0 place-items-center rounded-lg">
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                ))}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">{item.title}</span>
                {item.description && (
                  <span className="text-muted-foreground truncate text-xs">{item.description}</span>
                )}
              </span>
              {item.hint && (
                <kbd className="text-muted-foreground ms-auto shrink-0 text-[11px]">
                  {item.hint}
                </kbd>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}

export const SuggestionMenu = forwardRef(MenuInner) as <T extends MenuItem>(
  props: MenuProps<T> & { ref?: React.Ref<SuggestionMenuHandle> },
) => ReturnType<typeof MenuInner>;

/**
 * The `render` of a Tiptap Suggestion: mounts the menu next to the trigger
 * and hands it the keyboard.
 */
export function suggestionMenuRenderer<T extends MenuItem>(label: string, empty?: string) {
  return () => {
    let component: ReactRenderer<SuggestionMenuHandle, MenuProps<T>> | undefined;
    let unmount: (() => void) | undefined;
    const propsOf = (props: SuggestionProps<T>): MenuProps<T> => ({
      items: props.items,
      command: props.command,
      label,
      empty,
    });
    return {
      onStart: (props: SuggestionProps<T>) => {
        component = new ReactRenderer(SuggestionMenu as never, {
          editor: props.editor,
          props: propsOf(props),
        });
        unmount = props.mount(component.element as HTMLElement);
      },
      onUpdate: (props: SuggestionProps<T>) => component?.updateProps(propsOf(props)),
      onKeyDown: (props: SuggestionKeyDownProps) => {
        if (props.event.key === "Escape") {
          unmount?.();
          component?.destroy();
          component = undefined;
          return true;
        }
        return component?.ref?.onKeyDown(props) ?? false;
      },
      onExit: () => {
        unmount?.();
        component?.destroy();
        component = undefined;
      },
    };
  };
}
