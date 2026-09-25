"use client";

import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { useRef } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Editing a list of short bullets (responsibilities, decides alone): each
 * bullet is a text field; Enter adds one below, Backspace in an empty one
 * removes it, and the buttons reorder or delete.
 */
export function BulletListEditor({
  label,
  items,
  onChange,
  placeholder,
  max = 25,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
  max?: number;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const focus = (i: number) => requestAnimationFrame(() => refs.current[i]?.focus());

  const update = (i: number, value: string) => onChange(items.map((item, j) => (j === i ? value : item)));
  const insert = (i: number) => {
    if (items.length >= max) return;
    onChange([...items.slice(0, i), "", ...items.slice(i)]);
    focus(i);
  };
  const remove = (i: number) => {
    onChange(items.filter((_, j) => j !== i));
    focus(Math.max(0, i - 1));
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
    focus(j);
  };

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{label}</legend>
      {items.length === 0 && <p className="text-muted-foreground text-sm">None yet.</p>}
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-center gap-1">
            <Input
              ref={(el) => {
                refs.current[i] = el;
              }}
              value={item}
              maxLength={400}
              placeholder={placeholder}
              aria-label={`${label} ${i + 1}`}
              onChange={(e) => update(i, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  insert(i + 1);
                } else if (e.key === "Backspace" && item === "" && items.length > 0) {
                  e.preventDefault();
                  remove(i);
                }
              }}
            />
            <Button type="button" variant="ghost" size="icon-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${label.toLowerCase()} ${i + 1} up`}>
              <ArrowUp />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => move(i, 1)}
              disabled={i === items.length - 1}
              aria-label={`Move ${label.toLowerCase()} ${i + 1} down`}
            >
              <ArrowDown />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" onClick={() => remove(i)} aria-label={`Remove ${label.toLowerCase()} ${i + 1}`}>
              <X />
            </Button>
          </li>
        ))}
      </ul>
      <Button type="button" variant="outline" size="sm" onClick={() => insert(items.length)} disabled={items.length >= max}>
        <Plus className="size-4" aria-hidden="true" />
        Add
      </Button>
    </fieldset>
  );
}
