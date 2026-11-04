"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { hasModifier, isTypingTarget, overlayOpen } from "@/lib/shortcuts";

/**
 * The Today list's keys: j and k move down and up the rows, Enter opens
 * one, n adds a person. The rows are the page's own links, focused in turn.
 */
export function CrmTodayKeys({ hrefs }: { hrefs: string[] }) {
  const router = useRouter();
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || hasModifier(e) || isTypingTarget(e) || overlayOpen()) return;
      const rows = [...document.querySelectorAll<HTMLAnchorElement>("[data-today-row]")];
      const at = rows.findIndex((r) => r === document.activeElement);
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        const next = e.key === "j" ? Math.min(at + 1, rows.length - 1) : Math.max(at - 1, 0);
        rows[next]?.focus();
      } else if (e.key === "n") {
        e.preventDefault();
        const base = window.location.pathname.replace(/\/crm.*$/, "/crm");
        router.push(`${base}/people?new=1`);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, hrefs]);
  return null;
}
