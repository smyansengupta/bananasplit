"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";

import { cn } from "@/lib/utils";

import type { SlashCommandItem } from "./slash-command-items";

interface SlashCommandListProps {
  items: SlashCommandItem[];
  command: (item: SlashCommandItem) => void;
}

export interface SlashCommandListHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

export const SlashCommandList = forwardRef<SlashCommandListHandle, SlashCommandListProps>(
  function SlashCommandList({ items, command }, ref) {
    const [selectedIndex, setSelectedIndex] = useState(0);

    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (event.key === "ArrowDown") {
          setSelectedIndex((index) => (index + 1) % items.length);
          return true;
        }
        if (event.key === "ArrowUp") {
          setSelectedIndex((index) => (index - 1 + items.length) % items.length);
          return true;
        }
        if (event.key === "Enter") {
          const item = items[selectedIndex];
          if (item) command(item);
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) {
      return (
        <div className="bg-popover text-muted-foreground w-64 rounded-md border p-3 text-sm shadow-md">
          No matching blocks
        </div>
      );
    }

    return (
      <div className="bg-popover w-64 overflow-hidden rounded-md border p-1 shadow-md">
        {items.map((item, index) => (
          <button
            key={item.title}
            type="button"
            onClick={() => command(item)}
            onMouseEnter={() => setSelectedIndex(index)}
            className={cn(
              "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
              index === selectedIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
            )}
          >
            <item.icon className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium">{item.title}</span>
              <span className="text-muted-foreground truncate text-xs">{item.description}</span>
            </span>
          </button>
        ))}
      </div>
    );
  },
);
