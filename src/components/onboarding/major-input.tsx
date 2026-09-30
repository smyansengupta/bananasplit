"use client";

import { GraduationCap } from "lucide-react";
import { useId, useState } from "react";

import { Input } from "@/components/ui/input";
import { suggestMajors } from "@/lib/onboarding/majors";
import { cn } from "@/lib/utils";

/**
 * A text input that suggests majors while typing (an ARIA combobox). Any
 * text is accepted; the list only helps. Arrow keys move, Enter or Tab
 * picks, Escape closes.
 */
export function MajorInput({
  id,
  value,
  onChange,
  placeholder = "Start typing, e.g. Computer Science",
  className,
  autoFocus,
  ...rest
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  maxLength?: number;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const suggestions = open ? suggestMajors(value) : [];
  const shown = suggestions.length > 0;

  function pick(major: string) {
    onChange(major);
    setOpen(false);
  }

  return (
    <div className="relative">
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={listId}
        aria-activedescendant={shown ? `${listId}-${active}` : undefined}
        className={className}
        onChange={(e) => {
          onChange(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (!shown) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => (i + 1) % suggestions.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => (i - 1 + suggestions.length) % suggestions.length);
          } else if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
            e.preventDefault();
            pick(suggestions[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        {...rest}
      />
      {shown && (
        <ul
          id={listId}
          role="listbox"
          className="bg-popover text-popover-foreground animate-in fade-in-0 zoom-in-95 absolute top-full right-0 left-0 z-50 mt-1 overflow-hidden rounded-lg border p-1 shadow-md"
        >
          {suggestions.map((major, i) => (
            <li
              key={major}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // mousedown, not click: it fires before the input's blur.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(major);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                i === active && "bg-accent text-accent-foreground",
              )}
            >
              <GraduationCap className="text-muted-foreground size-3.5" aria-hidden="true" />
              <Highlight text={major} query={value} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  const at = q ? text.toLowerCase().indexOf(q) : -1;
  if (at < 0) return <span>{text}</span>;
  return (
    <span>
      {text.slice(0, at)}
      <span className="font-semibold">{text.slice(at, at + q.length)}</span>
      {text.slice(at + q.length)}
    </span>
  );
}
