"use client";

import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Home's small moments of change, played once when something is different
 * from your last look (kept in this browser only): a number rolls from the
 * value you last saw to the new one, and a row you haven't seen yet slides
 * in with a tint that fades. Nothing moves on a first visit, and nothing
 * moves with reduced motion (globals.css turns the animations off).
 */

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private windows and blocked storage: the moment just doesn't play.
  }
}

/** A number that rolls from the one you last saw here to this one. */
export function TickNumber({ value, storageKey }: { value: number; storageKey: string }) {
  const [from, setFrom] = useState<number | null>(null);
  useEffect(() => {
    const raw = read(storageKey);
    write(storageKey, String(value));
    const prev = raw === null ? NaN : Number(raw);
    // Shown once, when the stored number differs: a setState in an effect is the point here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (Number.isFinite(prev) && prev !== value) setFrom(prev);
  }, [storageKey, value]);

  if (from === null) return <span className="tabular-nums">{value}</span>;
  const up = value > from;
  return (
    <>
      {/* A span can't carry a label; screen readers read this instead of the roll. */}
      <span className="sr-only">{value}</span>
      <span className="tick-roll tabular-nums" aria-hidden="true">
        <span data-dir={up ? "up" : "down"}>
          <span>{up ? from : value}</span>
          <span>{up ? value : from}</span>
        </span>
      </span>
    </>
  );
}

/**
 * The ids in `ids` you haven't seen here before, as a set; it remembers
 * them all for next time. Empty on a first visit, so nothing plays then.
 */
export function useUnseen(storageKey: string, ids: readonly string[]): ReadonlySet<string> {
  const [unseen, setUnseen] = useState<ReadonlySet<string>>(new Set());
  const joined = ids.join("|");
  useEffect(() => {
    const raw = read(storageKey);
    const now = joined ? joined.split("|") : [];
    write(storageKey, now.slice(0, 200).join("|"));
    if (raw === null) return;
    const before = new Set(raw ? raw.split("|") : []);
    const fresh = now.filter((id) => !before.has(id));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (fresh.length > 0) setUnseen(new Set(fresh));
  }, [storageKey, joined]);
  return unseen;
}

/** A row that slides in with a soft tint when it's new to you. */
export function Arrive({
  on,
  className,
  children,
}: {
  on: boolean;
  className?: string;
  children: ReactNode;
}) {
  return <li className={cn(className, on && "row-arrive")}>{children}</li>;
}
