"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";

/**
 * A CRM list's state is its URL (?q, ?status, ?owner, ?sort...), so a
 * filtered list is a link to share and Back really goes back. `set` merges
 * a patch (undefined or "" removes a key) and resets the page.
 */
export function useUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const get = useCallback((key: string) => params.get(key) ?? undefined, [params]);
  const hrefWith = useCallback(
    (patch: Record<string, string | undefined | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      if (!("page" in patch)) next.delete("page");
      const qs = next.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [params, pathname],
  );
  const set = useCallback(
    (patch: Record<string, string | undefined | null>, options: { replace?: boolean } = {}) => {
      const href = hrefWith(patch);
      start(() =>
        options.replace
          ? router.replace(href, { scroll: false })
          : router.push(href, { scroll: false }),
      );
    },
    [hrefWith, router],
  );
  return { get, set, hrefWith, pending, params };
}
