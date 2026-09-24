"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";

/**
 * URL state for a database view, in the shared grammar
 * (src/lib/databases/href.ts): f=col:op:value (repeatable), sort, q, from,
 * to, page, row, plus this section's size, cols (visible columns), nd
 * (default filters turned off) and view (sub-views such as ballots).
 */

export interface ViewParamsApi {
  params: URLSearchParams;
  pending: boolean;
  /** Applies a change and navigates. Anything but a row/page change resets to page 1. */
  update: (change: (p: URLSearchParams) => void, options?: { keepPage?: boolean; push?: boolean }) => void;
  href: (change: (p: URLSearchParams) => void) => string;
}

export function useViewParams(): ViewParamsApi {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, start] = useTransition();

  const build = useCallback(
    (change: (p: URLSearchParams) => void, keepPage = false) => {
      const p = new URLSearchParams(search.toString());
      change(p);
      if (!keepPage) p.delete("page");
      const qs = p.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [pathname, search],
  );

  const update = useCallback(
    (change: (p: URLSearchParams) => void, options: { keepPage?: boolean; push?: boolean } = {}) => {
      const url = build(change, options.keepPage);
      start(() => {
        if (options.push) router.push(url, { scroll: false });
        else router.replace(url, { scroll: false });
      });
    },
    [build, router],
  );

  return {
    params: new URLSearchParams(search.toString()),
    pending,
    update,
    href: (change) => build(change, true),
  };
}

/** The f= values without the one for (col, op, value). */
export function withoutFilter(p: URLSearchParams, raw: string): void {
  const rest = p.getAll("f").filter((f) => f !== raw);
  p.delete("f");
  for (const f of rest) p.append("f", f);
}

export function addToList(p: URLSearchParams, name: string, value: string): void {
  const list = (p.get(name) ?? "").split(",").filter(Boolean);
  if (!list.includes(value)) list.push(value);
  p.set(name, list.join(","));
}

export function removeFromList(p: URLSearchParams, name: string, value: string): void {
  const list = (p.get(name) ?? "").split(",").filter((v) => v && v !== value);
  if (list.length) p.set(name, list.join(","));
  else p.delete(name);
}
